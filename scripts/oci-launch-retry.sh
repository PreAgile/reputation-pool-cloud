#!/usr/bin/env bash
# A1 인스턴스 생성 재시도 루프 (#15) — `Out of host capacity` 가 풀리는 순간을 잡는다.
#
# Oracle 무료 티어에서 VM.Standard.A1.Flex 2 OCPU/12GB 는 용량 고갈이 흔하다(#15 §5). 콘솔에서 손으로
# 누르면 (a) 사람이 붙어 있어야 하고 (b) 짧게 연달아 누르면 용량 에러가 아니라 API 레이트 리밋
# (`TooManyRequests`)이 뜬다. 이 스크립트는 일정 간격으로 한 번씩만 시도하고, 리밋에는 지수 백오프로
# 물러나며, 성공하면 즉시 멈추고 공인 IP 와 접속 명령을 출력한다.
#
# 인스턴스가 회수됐을 때의 재구축 경로이기도 하다 — #15 §5 가 요구하는 "30분 내 재구축 가능 상태"의
# 컴퓨트 부분이 이 스크립트고, OS 위쪽은 bootstrap.sh 다.
#
# 사전 준비 (한 번만):
#   brew install oci-cli
#   oci setup config          # user OCID / tenancy OCID / region(ap-tokyo-1) 입력 → API 키 생성
#   # 생성된 ~/.oci/oci_api_key_public.pem 를 콘솔에 등록:
#   #   Profile → User settings → API keys → Add API key → Paste public key
#
# 실행:
#   ./scripts/oci-launch-retry.sh
#
# 환경변수로 조정 (전부 선택):
#   OCPUS=2 MEMORY_GB=12 BOOT_GB=50 INTERVAL=90 MAX_ATTEMPTS=0
#   SSH_KEY_FILE=~/.ssh/oci_rp_work.pub DISPLAY_NAME=reputation-pool-prod
#   TENANCY=... AD=... SUBNET=... IMAGE=...   # 자동 탐색이 실패할 때만
#
# 세션 토큰(`oci session authenticate`)이 아니라 **API 키 인증**을 쓴다: 세션 토큰은 1시간마다 만료돼
# 장시간 루프가 중간에 죽는다.
set -euo pipefail

# CLI 가 매 호출마다 붙이는 키 라벨 권고 경고를 끈다 — 오류 판별용 출력에 섞이면 읽기 어렵다.
export SUPPRESS_LABEL_WARNING=True

SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCPUS:-2}"
MEMORY_GB="${MEMORY_GB:-12}"
BOOT_GB="${BOOT_GB:-50}"
# 용량 에러 시 재시도 간격(초). 90초면 API 호출이 분당 1회 미만이라 레이트 리밋에 걸리지 않는다.
INTERVAL="${INTERVAL:-90}"
# 0 = 무한 재시도.
MAX_ATTEMPTS="${MAX_ATTEMPTS:-0}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/oci_rp_work.pub}"
DISPLAY_NAME="${DISPLAY_NAME:-reputation-pool-prod}"
# 레이트 리밋에 걸렸을 때의 첫 백오프와 상한.
BACKOFF_START=300
BACKOFF_MAX=1800

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v oci > /dev/null 2>&1 || die "oci CLI 가 없다 — 'brew install oci-cli' 후 'oci setup config' 를 실행한다"
[ -f "$SSH_KEY_FILE" ] || die "SSH 공개키가 없다: $SSH_KEY_FILE (SSH_KEY_FILE 로 지정 가능)"
[ -f "$HOME/.oci/config" ] || die "$HOME/.oci/config 가 없다 — 'oci setup config' 를 먼저 실행한다"

# ---------------------------------------------------------------------------
# 필요한 OCID 들을 탐색한다. 콘솔에서 복사해 붙이는 과정을 없애 오타 가능성을 줄인다.
#
# 조회를 재시도로 감싼다: API 키를 방금 등록했다면 서비스별 엔드포인트로 전파되는 시차 때문에 401 이
# 섞여 나온다(identity 는 통과하는데 compute/virtual_network 는 아직 401인 상태가 몇 분 이어진다).
# 재시도가 없으면 여기서 죽어 정작 용량 대기를 시작하지도 못한다.
# ---------------------------------------------------------------------------
oci_try() {
	local label="$1"
	shift
	local i out
	for i in $(seq 1 24); do
		if out="$("$@" 2> /dev/null)" && [ -n "$out" ] && [ "$out" != "null" ]; then
			printf '%s' "$out"
			return 0
		fi
		printf '%s  %s 조회 재시도 %d/24\n' "$(date '+%H:%M:%S')" "$label" "$i" >&2
		sleep 10
	done
	die "$label 조회가 4분간 실패했다 — 인증 전파 지연이거나 대상이 없다"
}

TENANCY="${TENANCY:-$(awk -F= '/^tenancy[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' "$HOME/.oci/config")}"
[ -n "$TENANCY" ] || die "$HOME/.oci/config 에서 tenancy OCID 를 찾지 못했다 — TENANCY 로 직접 지정한다"

if [ -z "${AD:-}" ]; then
	AD="$(oci_try '가용성 도메인' \
		oci iam availability-domain list --compartment-id "$TENANCY" \
		--query 'data[0].name' --raw-output)"
fi

# 퍼블릭 서브넷 = 공인 IP 할당이 금지되지 않은 서브넷. 여러 개면 첫 번째를 쓴다.
# 백틱은 JMESPath 의 리터럴 표기다(셸 명령 치환이 아니므로 단일 인용을 유지해야 한다).
# shellcheck disable=SC2016
if [ -z "${SUBNET:-}" ]; then
	SUBNET="$(oci_try '퍼블릭 서브넷' \
		oci network subnet list --compartment-id "$TENANCY" \
		--query 'data[?"prohibit-public-ip-on-vnic"==`false`].id | [0]' --raw-output)"
fi

# --shape 로 필터하면 해당 shape 아키텍처(arm64)에 맞는 빌드만 나온다.
if [ -z "${IMAGE:-}" ]; then
	IMAGE="$(oci_try 'Ubuntu 24.04 (arm64) 이미지' \
		oci compute image list --compartment-id "$TENANCY" \
		--operating-system 'Canonical Ubuntu' --operating-system-version '24.04' \
		--shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
		--query 'data[0].id' --raw-output)"
fi

# ssh_authorized_keys 를 셸에서 JSON 문자열로 만들면 인용 문제가 생긴다 — 파일로 넘긴다.
METADATA_FILE="$(mktemp)"
trap 'rm -f "$METADATA_FILE"' EXIT
# JSON 문자열이므로 실제 개행을 넣을 수 없다. 빈 줄을 버리고 키들을 리터럴 \n 으로 이어 붙인다
# (키가 하나면 그대로 한 줄).
keys="$(awk 'NF { printf "%s%s", sep, $0; sep = "\\n" } END { print "" }' "$SSH_KEY_FILE")"
[ -n "$keys" ] || die "SSH 공개키 파일이 비어 있다: $SSH_KEY_FILE"
printf '{"ssh_authorized_keys": "%s"}' "$keys" > "$METADATA_FILE"

if [ "$MAX_ATTEMPTS" -eq 0 ]; then
	retry_desc="(무한)"
else
	retry_desc="(최대 ${MAX_ATTEMPTS}회)"
fi

cat <<EOF

대상 구성
  shape        $SHAPE  ($OCPUS OCPU / ${MEMORY_GB}GB)
  boot volume  ${BOOT_GB}GB
  AD           $AD
  subnet       ${SUBNET##*.}
  image        ${IMAGE##*.}
  ssh key      $SSH_KEY_FILE
  재시도       ${INTERVAL}초 간격 ${retry_desc}

중단은 Ctrl-C. 성공하면 자동으로 멈춥니다.
EOF

# ---------------------------------------------------------------------------
# 재시도 루프
# ---------------------------------------------------------------------------
attempt=0
auth_fail=0
transient=0
backoff="$BACKOFF_START"
started="$(date +%s)"

while :; do
	attempt=$((attempt + 1))
	if [ "$MAX_ATTEMPTS" -gt 0 ] && [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
		die "최대 시도 횟수($MAX_ATTEMPTS)를 넘었다 — 용량이 계속 없다"
	fi

	elapsed=$(( ($(date +%s) - started) / 60 ))
	log "시도 #${attempt} (경과 ${elapsed}분)"

	if out="$(oci compute instance launch \
		--compartment-id "$TENANCY" \
		--availability-domain "$AD" \
		--shape "$SHAPE" \
		--shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}" \
		--image-id "$IMAGE" \
		--subnet-id "$SUBNET" \
		--assign-public-ip true \
		--boot-volume-size-in-gbs "$BOOT_GB" \
		--display-name "$DISPLAY_NAME" \
		--metadata "file://${METADATA_FILE}" \
		--wait-for-state RUNNING 2>&1)"; then
		log "생성 성공"
		break
	fi

	# 용량 고갈 — 정상적인 재시도 대상.
	if grep -qiE 'out of (host )?capacity' <<< "$out"; then
		log "용량 없음 — ${INTERVAL}초 후 재시도"
		backoff="$BACKOFF_START"
		sleep "$INTERVAL"
		continue
	fi

	# 레이트 리밋 — 더 물러난다. 여기서 짧게 재시도하면 리밋 창이 계속 갱신된다.
	if grep -qiE 'toomanyrequests|too many requests|429' <<< "$out"; then
		log "API 레이트 리밋 — ${backoff}초 후 재시도"
		sleep "$backoff"
		backoff=$(( backoff * 2 ))
		[ "$backoff" -le "$BACKOFF_MAX" ] || backoff="$BACKOFF_MAX"
		continue
	fi

	# API 키를 콘솔에 등록한 직후에는 서비스별 엔드포인트로 전파되는 시차 때문에 401 이 섞여 나온다
	# (identity 는 통과하는데 compute 는 아직 401인 상태가 몇 분 이어진다). 제한된 횟수만 기다린다 —
	# 계속 나오면 전파가 아니라 키 등록 자체가 안 된 것이다.
	if grep -qiE 'notauthenticated|"status": 401' <<< "$out"; then
		auth_fail=$((auth_fail + 1))
		if [ "$auth_fail" -le 20 ]; then
			log "인증 실패 ${auth_fail}/20 (키 전파 지연으로 보임) — 15초 후 재시도"
			sleep 15
			continue
		fi
		printf '%s\n' "$out" >&2
		die "인증이 계속 실패한다 — 콘솔 User settings → API keys 에 지문이 등록됐는지 확인한다"
	fi

	# 일시적 통신·서버 오류. 시간 단위로 도는 루프에서는 반드시 만난다 — 초판은 28분 시점에
	# `RequestException: The connection to endpoint timed out` 으로 죽어 그때까지의 대기를 날렸다.
	# 용량 대기와 성격이 같으므로 같은 간격으로 재시도한다.
	if grep -qiE 'requestexception|timed out|timeout|connection (aborted|reset|error)|serviceunavailable|internalservererror|"status": 5[0-9][0-9]' <<< "$out"; then
		transient=$((transient + 1))
		log "일시적 통신 오류 #${transient} — ${INTERVAL}초 후 재시도"
		sleep "$INTERVAL"
		continue
	fi

	# 그 외(권한·잘못된 OCID·한도 초과 등)는 재시도해도 달라지지 않는다.
	printf '%s\n' "$out" >&2
	die "재시도로 해결되지 않는 오류다 — 위 메시지를 확인한다"
done

# ---------------------------------------------------------------------------
# 결과 출력
# ---------------------------------------------------------------------------
instance_id="$(printf '%s' "$out" | sed -n 's/.*"id": "\(ocid1\.instance[^"]*\)".*/\1/p' | head -1)"
if [ -z "$instance_id" ]; then
	instance_id="$(oci compute instance list --compartment-id "$TENANCY" \
		--display-name "$DISPLAY_NAME" --lifecycle-state RUNNING \
		--query 'data[0].id' --raw-output)"
fi

public_ip="$(oci compute instance list-vnics --instance-id "$instance_id" \
	--query 'data[0]."public-ip"' --raw-output 2> /dev/null || true)"

# 장시간 루프를 돌리다 놓치지 않도록 알린다(macOS).
printf '\a'
if command -v osascript > /dev/null 2>&1; then
	osascript -e 'display notification "A1 인스턴스 생성 성공" with title "reputation-pool"' > /dev/null 2>&1 || true
fi

cat <<EOF

==> 완료 (시도 ${attempt}회, 일시적 오류 ${transient}회 흡수)
  instance   $instance_id
  public IP  ${public_ip:-<콘솔에서 확인>}

다음 단계
  ssh -i ${SSH_KEY_FILE%.pub} ubuntu@${public_ip:-<IP>}

  그다음 VCN Security List 인그레스(80/443 TCP, 443 UDP)와 bootstrap.sh —
  docs/engineering/deployment.md §2, §4
EOF
