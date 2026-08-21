#!/usr/bin/env bash
# 오프사이트 백업 (#15) — DB 덤프를 OCI Object Storage 로 올린다.
#
# ## 왜 필요한가
# `backup.sh` 는 이미 하루 한 번 덤프를 남기지만 **그 덤프는 이 서버 안의 도커 볼륨에 있다.** 인스턴스가
# 사라지면(체험 크레딧 만료 후 유예 종료, 유휴 회수, 리전 사고) 원본과 백업이 **함께** 사라진다.
# 백업이 원본과 같은 운명을 공유하면 백업이 아니다.
#
# Object Storage 는 Always Free 20GB 이고 컴퓨트와 수명이 분리돼 있다. 덤프가 수십 KB 수준이라 용량은
# 문제가 되지 않는다.
#
# ## 인증
# 인스턴스 프린시펄을 쓴다(`OCI_CLI_AUTH=instance_principal`). 공개 서버에 API 키 파일을 두지 않기
# 위해서다. 권한은 **버킷 하나로 한정**한다:
#   Allow dynamic-group rp-prod-host to manage objects in tenancy where target.bucket.name='rp-backups'
# `manage buckets` 를 주지 않으므로 이 호스트가 침해되어도 **버킷 자체를 지울 수는 없다** — 오프사이트
# 백업의 의미는 "여기가 털려도 저기는 남는다" 이므로 그 경계를 권한으로 만든다.
#
# ## 사용
#   ./scripts/backup-offsite.sh                # 미업로드 덤프 업로드 + 원격 보존기간 정리
#   ./scripts/backup-offsite.sh --dry-run      # 무엇을 할지만 출력
#   ./scripts/backup-offsite.sh --verify-latest # 최신 원격 덤프를 내려받아 pg_restore --list 로 검증
#   ./scripts/backup-offsite.sh --install      # systemd 타이머 설치(매일 08:00 UTC)
#   ./scripts/backup-offsite.sh --uninstall
#
# ## 설정 (환경변수 또는 ~/.rp-backup.env)
#   OFFSITE_BUCKET=rp-backups
#   OFFSITE_PREFIX=db/
#   OFFSITE_RETENTION_DAYS=30      # 원격 보존(서버 볼륨은 backup.sh 가 7일). env/ 는 대상 아님
#   OFFSITE_VOLUME=               # 비우면 자동 탐색
#   OFFSITE_METRICS_VOLUME=       # 신선도 textfile 볼륨(#131). 비우면 자동 탐색
#   OFFSITE_ENV_CERT=/home/ubuntu/.rp-backup-cert.pem   # .env 를 암호화할 **공개** 인증서. 미설정이면 경고만
#   OFFSITE_ENV_PREFIX=env/
#   OFFSITE_ALERT_MAIL=auto        # auto=systemd 실행일 때만 메일 | always | never
#
# `.env`(DB 비밀번호·admin JWT·API 키)도 **인증서로 암호화해** 함께 올린다. DB 만 올려 두면 인스턴스가
# 사라졌을 때 데이터는 있는데 열 열쇠가 없다. 개인키는 이 호스트에 두지 않는다 — 복호화는 운영자 노트북에서
# 한다(§8-1 의 복원 절차). 그래서 이 호스트가 침해되어도 올린 시크릿을 되읽을 수 없다.
#
# 실패하면 메일로 알린다(`notify-mail.py`). 백업의 진짜 실패 모드는 "안 도는 것" 이 아니라 "안 도는데
# 아무도 모르는 것" 이다. 단 **손으로 돌리다 실패한 것은 메일로 보내지 않는다** — 화면에 이미 에러가 있고,
# 조작 실수가 백업 실패 알림으로 나가면 알림 자체를 믿지 않게 된다(`should_mail` 참고).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

export SUPPRESS_LABEL_WARNING=True
export OCI_CLI_AUTH="${OCI_CLI_AUTH:-instance_principal}"

# oci CLI 는 공식 설치 스크립트가 `~/bin` 에 넣는다. systemd 유닛에는 `--install` 이 그 경로를 PATH 로
# 박아 주지만(아래 UNIT 참고), **손으로 돌릴 때는 그 환경이 없다.** 특히 `ssh <호스트> './scripts/…'`
# 형태의 비대화형 셸은 `.profile` 을 읽지 않아 PATH 에 `~/bin` 이 없고, 그러면 아래 `command -v oci` 가
# **설치돼 있는데도** 걸려 "oci CLI 가 없다" 로 죽는다(2026-08-05 실제로 그 알림 메일이 나갔다 — 같은 날
# 08:03 의 타이머 실행은 정상이었다). 진단이 실제 원인("PATH 에 없다")과 어긋나는 것이 가장 나쁘므로,
# 있으면 붙이고 없으면 원래대로 실패한다.
if [ -d "$HOME/bin" ]; then
	case ":$PATH:" in
		*":$HOME/bin:"*) ;;
		*) export PATH="$HOME/bin:$PATH" ;;
	esac
fi

CONF="${RP_BACKUP_ENV:-$HOME/.rp-backup.env}"
if [ -f "$CONF" ]; then
	# source 하지 않는다(값에 셸 메타문자가 들어올 수 있다) — notify-mail.py 와 같은 이유.
	while IFS= read -r line; do
		case "$line" in ''|'#'*) continue ;; esac
		key="${line%%=*}"; val="${line#*=}"
		case "$key" in OFFSITE_*) export "$key=$val" ;; esac
	done < "$CONF"
fi

BUCKET="${OFFSITE_BUCKET:-rp-backups}"
PREFIX="${OFFSITE_PREFIX:-db/}"
RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"
ALERT_MAIL="${OFFSITE_ALERT_MAIL:-auto}"
DRY_RUN=false
VERIFY_LATEST=false
ACTION=run

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=true ;;
		--verify-latest) VERIFY_LATEST=true ;;
		--install) ACTION=install ;;
		--uninstall) ACTION=uninstall ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$arg" >&2; exit 2 ;;
	esac
done

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"; }

# 메일을 보낼 실행인지 판단한다. **systemd 유닛으로 돌 때만 보내는 것이 기본이다.**
#
# 이 스크립트를 손으로 돌리다 실패하면(PATH·오타·인자) 그것까지 "오프사이트 백업이 실패했습니다" 메일로
# 나간다. 화면에 이미 같은 에러가 떠 있으니 정보는 늘지 않고 알림 피로만 쌓이는데, 그러다 **진짜 실패
# 메일까지 흘려보게 되는 것**이 이 스크립트가 애초에 막으려던 실패다. 게다가 메일 본문은 `journalctl -u
# rp-backup-offsite.service` 를 안내하므로, 손 실행 실패가 "타이머가 깨졌다" 로 읽힌다(2026-08-05 실제로
# 그렇게 한 번 헷갈렸다 — 그 시각 타이머는 돌지도 않았다).
#
# 판정에 `[ -t 1 ]`(TTY) 를 쓰지 않는다. 그 사고가 `ssh <호스트> './scripts/backup-offsite.sh'` 였는데
# 그 형태는 pty 가 없어서 TTY 검사로는 자동 실행과 구분되지 않는다 — 정작 막아야 할 경우를 못 막는다.
# `INVOCATION_ID` 는 systemd 가 유닛을 실행할 때 **항상** 넣어 주고 손 실행에는 없으므로 두 경우를
# 정확히 가른다.
#
# 자동 실행인데 메일이 조용해지는 것이 이 판단의 유일한 위험이므로 덮을 손잡이를 남긴다
# (`~/.rp-backup.env` 에서도 설정된다):
#   OFFSITE_ALERT_MAIL=auto    기본 — systemd 실행일 때만 보낸다
#   OFFSITE_ALERT_MAIL=always  손 실행에서도 보낸다 (cron 등 systemd 밖의 자동화)
#   OFFSITE_ALERT_MAIL=never   보내지 않는다
should_mail() {
	case "$ALERT_MAIL" in
		always) return 0 ;;
		never) return 1 ;;
		*) [ -n "${INVOCATION_ID:-}" ] ;;
	esac
}

# 실패는 반드시 사람에게 닿아야 한다. 메일 설정이 없으면 로그만 남는다(그 사실도 로그에 남긴다).
alert() {
	local subject="$1" body="$2" rc=0
	if ! should_mail; then
		# 조용히 넘어가지 않는다 — 무엇을 왜 안 했는지까지 남겨야 이 생략이 사고로 오해되지 않는다.
		log "메일 생략 — systemd 실행이 아니다(에러는 위에 있다). 강제하려면 OFFSITE_ALERT_MAIL=always"
		return
	fi
	printf '%s\n' "$body" | python3 "$REPO_DIR/scripts/notify-mail.py" "$subject" > /dev/null 2>&1 || rc=$?
	case "$rc" in
		0) log "실패 알림 메일 발송" ;;
		2) log "warn: 메일 설정이 없어 알림을 보내지 못했다 (~/.rp-mail.env)" ;;
		*) log "warn: 알림 메일 발송 실패 (rc=$rc)" ;;
	esac
}

die() {
	log "error: $1"
	alert "[reputation-pool] 오프사이트 백업 실패" "$(printf '오프사이트 백업이 실패했습니다.\n\n  사유: %s\n  호스트: %s\n  시각: %s\n\n확인:\n  journalctl -u rp-backup-offsite.service -n 50 --no-pager\n' \
		"$1" "$(hostname)" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')")"
	exit 1
}

# 오타를 **알림 경로를 쓰기 전에** 잡는다. `OFFSITE_ALERT_MAIL=alwyas` 는 `should_mail` 의 기본 갈래로
# 떨어져 **손 실행에서 메일이 조용히 안 나가는데 설정한 사람은 나간다고 믿는** 상태를 만든다. 알림 설정의
# 오타는 알림이 필요한 날에만 드러나므로 시작 시점에 죽는 편이 낫다. `oci`·`docker` 확인보다 앞에 두는
# 이유도 같다 — 도구가 무엇이 있든 이 설정은 이미 틀렸고, 이 뒤의 모든 `die` 가 이 값에 기대어 동작한다.
case "$ALERT_MAIL" in
	auto | always | never) ;;
	*) die "OFFSITE_ALERT_MAIL 은 auto|always|never 여야 한다 (받은 값: '$ALERT_MAIL')" ;;
esac

SERVICE=/etc/systemd/system/rp-backup-offsite.service
TIMER=/etc/systemd/system/rp-backup-offsite.timer

if [ "$ACTION" = uninstall ]; then
	sudo systemctl disable --now rp-backup-offsite.timer 2> /dev/null || true
	sudo rm -f "$SERVICE" "$TIMER"
	sudo systemctl daemon-reload
	echo "제거 완료. 버킷의 오브젝트는 그대로 남아 있다."
	exit 0
fi

if [ "$ACTION" = install ]; then
	[ "$(id -un)" != root ] || { printf 'error: root 로 실행하지 않는다\n' >&2; exit 1; }
	sudo -n true 2> /dev/null || { printf 'error: 비밀번호 없는 sudo 가 필요하다\n' >&2; exit 1; }

	# 사이드카가 07:32 UTC 에 덤프를 만든다. 그 뒤에 올린다.
	sudo tee "$SERVICE" > /dev/null <<UNIT
[Unit]
Description=reputation-pool DB 덤프를 Object Storage 로 올린다 (#15)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$REPO_DIR
Environment=OCI_CLI_AUTH=instance_principal
Environment=PATH=$HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$REPO_DIR/scripts/backup-offsite.sh
TimeoutStartSec=30min
UNIT

	sudo tee "$TIMER" > /dev/null <<'UNIT'
[Unit]
Description=오프사이트 백업 타이머 (매일 08:00 UTC)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md

[Timer]
OnCalendar=*-*-* 08:00:00 UTC
# 서버가 꺼져 있어 놓친 주기를 부팅 후 한 번 실행한다. 백업은 건너뛰면 그대로 구멍이 된다.
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
UNIT

	sudo systemctl daemon-reload
	sudo systemctl enable --now rp-backup-offsite.timer
	systemctl list-timers rp-backup-offsite.timer --no-pager || true
	echo
	echo "설치 완료. 즉시 한 번: sudo systemctl start rp-backup-offsite.service"
	exit 0
fi

# ---------------------------------------------------------------------------
# 준비
# ---------------------------------------------------------------------------
command -v oci > /dev/null 2>&1 || die "oci CLI 가 없다"
command -v python3 > /dev/null 2>&1 || die "python3 가 없다"

# 설정값이 정수인지 여기서 잡는다. 그러지 않으면 아래 `[ "$RETENTION_DAYS" -gt 0 ]` 이 "integer
# expression expected" 를 stderr 에 흘리고 **거짓으로 평가되어 정리 단계 전체가 조용히 스킵된다** —
# 이 스크립트가 막으려는 실패 형태와 정확히 같다. 설정 오타는 시작 시점에 죽는 편이 낫다.
case "$RETENTION_DAYS" in
	'' | *[!0-9]*) die "OFFSITE_RETENTION_DAYS 는 0 이상의 정수여야 한다 (받은 값: '$RETENTION_DAYS')" ;;
esac

if docker info > /dev/null 2>&1; then
	DOCKER=(docker)
elif sudo -n docker info > /dev/null 2>&1; then
	DOCKER=(sudo docker)
else
	die "docker 를 쓸 수 없다 (docker 그룹 또는 비밀번호 없는 sudo 가 필요하다)"
fi

# 볼륨 이름은 compose 프로젝트 접두어가 붙는다(<project>_reputation-pool-backups). 호스트마다 프로젝트
# 이름이 다를 수 있으므로 접미로 찾는다 — 박아 두면 다른 호스트에서 조용히 빈 목록을 백업한다.
VOLUME="${OFFSITE_VOLUME:-}"
if [ -z "$VOLUME" ]; then
	VOLUME="$("${DOCKER[@]}" volume ls --format '{{.Name}}' | grep -E '_reputation-pool-backups$' | head -1 || true)"
fi
[ -n "$VOLUME" ] || die "백업 볼륨을 찾지 못했다 (OFFSITE_VOLUME 로 지정한다)"

NAMESPACE="$(oci os ns get --query 'data' --raw-output 2> /dev/null || true)"
[ -n "$NAMESPACE" ] || die "Object Storage 네임스페이스를 조회하지 못했다 — 인스턴스 프린시펄 정책을 확인한다"

log "볼륨 $VOLUME -> os://$NAMESPACE/$BUCKET/$PREFIX"

# 볼륨 안의 덤프 목록(이름과 바이트 크기). alpine 한 번으로 끝낸다.
# 단일 인용은 의도적이다 — $f 와 $(stat) 은 호스트가 아니라 **컨테이너 안에서** 평가돼야 한다.
# shellcheck disable=SC2016
local_list="$("${DOCKER[@]}" run --rm -v "$VOLUME":/b:ro alpine:3 sh -c \
	'cd /b 2>/dev/null && ls -1 *.dump 2>/dev/null | while read -r f; do printf "%s %s\n" "$f" "$(stat -c %s "$f")"; done' || true)"
[ -n "$local_list" ] || die "볼륨에 덤프가 하나도 없다 — backup 사이드카가 도는지 확인한다 (docker compose ps backup)"

remote_list="$(oci os object list --namespace "$NAMESPACE" --bucket-name "$BUCKET" --prefix "$PREFIX" --all \
	--query 'data[].{name:name,size:size,created:"time-created"}' --output json 2> /dev/null || echo '[]')"

# ---------------------------------------------------------------------------
# 업로드 — 아직 없는 것만
# ---------------------------------------------------------------------------
uploaded=0
skipped=0
while read -r fname fsize; do
	[ -n "$fname" ] || continue
	object="${PREFIX}${fname}"
	# 이미 있고 크기가 같으면 건너뛴다. 크기가 다르면 중단된 업로드이므로 다시 올린다.
	rsize="$(printf '%s' "$remote_list" | python3 -c "
import json,sys
want = sys.argv[1]
try:
    items = json.load(sys.stdin) or []
except Exception:
    items = []
print(next((str(i.get('size')) for i in items if i.get('name') == want), ''))
" "$object")"
	if [ "$rsize" = "$fsize" ]; then
		skipped=$((skipped + 1))
		continue
	fi
	if [ "$DRY_RUN" = true ]; then
		log "[dry-run] 업로드했을 것: $object ($fsize bytes)"
		uploaded=$((uploaded + 1))
		continue
	fi

	tmp="$(mktemp)"
	"${DOCKER[@]}" run --rm -v "$VOLUME":/b:ro alpine:3 cat "/b/$fname" > "$tmp" \
		|| { rm -f "$tmp"; die "볼륨에서 덤프를 꺼내지 못했다: $fname"; }
	# 꺼낸 크기가 볼륨의 크기와 다르면 올리지 않는다 — 잘린 파일을 백업으로 남기는 것이 최악이다.
	got="$(wc -c < "$tmp" | tr -d ' ')"
	[ "$got" = "$fsize" ] || { rm -f "$tmp"; die "덤프 크기가 다르다: $fname (볼륨 $fsize, 읽은 값 $got)"; }

	oci os object put --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$object" \
		--file "$tmp" --force > /dev/null 2>&1 || { rm -f "$tmp"; die "업로드 실패: $object"; }
	rm -f "$tmp"

	# 올린 뒤 서버가 기억하는 크기를 다시 물어본다. put 이 성공했다는 말과 실제로 온전히 올라갔다는
	# 말은 다르다.
	head_size="$(oci os object head --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$object" \
		--query '"content-length"' --raw-output 2> /dev/null || true)"
	[ "$head_size" = "$fsize" ] || die "업로드 검증 실패: $object (기대 $fsize, 원격 ${head_size:-없음})"

	log "업로드 완료: $object ($fsize bytes)"
	uploaded=$((uploaded + 1))
done <<< "$local_list"

log "업로드 $uploaded 건, 이미 있어 건너뜀 $skipped 건"

# ---------------------------------------------------------------------------
# .env 암호화 업로드
# ---------------------------------------------------------------------------
# DB 는 매일 여기로 올라가는데 `.env`(DB 비밀번호·admin JWT 시크릿·테넌트 API 키)는 **이 호스트에만**
# 있다. 인스턴스가 유휴 회수되면(§10) 데이터는 남았는데 **열 열쇠가 없는** 상태가 되어 복원이 그 자리에서
# 막힌다. 정식 해법은 시크릿 스토어(#6)지만 그때까지의 구멍이 너무 크다.
#
# **대칭 암호를 쓰지 않는다.** 복구 시나리오가 "이 호스트가 사라졌다" 이므로 복호화 수단이 이 호스트에
# 있으면 백업이 아니다(암호를 여기 두면 침해 시 함께 털린다). 그래서 인증서(공개키)로만 암호화하고
# 개인키는 운영자 노트북·비밀 관리자에 둔다 — 이 호스트는 **자기가 올린 것을 스스로 읽을 수 없다.**
#
# 도구는 openssl CMS(하이브리드: 랜덤 AES 키를 RSA 로 봉인)다. age·gpg 는 이 호스트도 운영자 맥도
# 설치돼 있지 않았고(실측), openssl 은 양쪽 기본 설치라 새 의존성이 생기지 않는다. 대칭 키 봉인 방식이라
# `.env` 크기 제한도 없다(RSA 직접 암호화는 키 길이에 묶인다).
ENV_PREFIX="${OFFSITE_ENV_PREFIX:-env/}"
ENV_CERT="${OFFSITE_ENV_CERT:-}"

if [ -z "$ENV_CERT" ]; then
	# 조용히 건너뛰지 않는다 — 이 스크립트가 막으려는 실패 형태가 정확히 "안 하는데 아무도 모르는 것" 이다.
	log "warn: OFFSITE_ENV_CERT 미설정 — .env 가 오프사이트에 없다(인스턴스 소실 시 복원 불가). 설정법은 deployment.md §8-1"
elif [ ! -f "$REPO_DIR/.env" ]; then
	log "warn: $REPO_DIR/.env 가 없어 .env 백업을 건너뛴다"
else
	command -v openssl > /dev/null 2>&1 || die "openssl 이 없다 — .env 를 평문으로 올리는 대신 실패한다"

	# **수신자를 여러 명 둘 수 있다.** OFFSITE_ENV_CERT 를 콜론으로 구분하면(PATH 관례) CMS
	# EnvelopedData 에 recipientInfo 가 여러 개 들어가고, 각 개인키가 **독립적으로** 복호화한다.
	# 운영자 머신이 둘 이상일 때(회사 PC·집 PC) 개인키를 복사해 다니지 않는 유일한 방법이다 —
	# 개인키가 이동하면 사본이 늘어나고, 한 대가 침해되면 전부 재발급해야 한다.
	#
	# ⚠️ 인증서를 **한 파일에 이어붙이는 방식은 동작하지 않는다.** openssl 은 각 인증서 인자에서
	# 첫 번째 것만 읽으므로 두 번째 수신자가 **조용히 빠진다** — 암호화는 성공하고 파일도 정상
	# CMS 라서 사고를 알아챌 방법이 없다. 실측했다: `cat a.crt b.crt > both.pem` 으로 암호화하면
	# a 의 키로는 복호화되고 b 의 키로는 실패한다. 그래서 파일을 나누고 인자를 여러 개 넘긴다.
	ENV_CERTS=()
	while IFS= read -r _c; do
		[ -n "$_c" ] || continue
		[ -f "$_c" ] || die "OFFSITE_ENV_CERT 가 가리키는 인증서가 없다: $_c"
		# **파일당 PEM 객체는 정확히 하나, 그리고 그것이 인증서여야 한다.**
		#
		# `openssl x509 -noout` 만으로는 부족하다 — 그것은 첫 PEM 객체만 읽으므로 뒤에 무엇이 붙어
		# 있든 통과한다. 그래서 두 사고가 검사를 그대로 지나간다:
		#
		#   1. `cat a.crt b.crt > both.pem` — 첫 인증서만 수신자가 되고 두 번째가 조용히 빠진다.
		#      아래 수신자 수 검사도 이것을 잡지 못한다: 그 검사는 **경로 개수**와 비교하므로
		#      경로 1개 / 수신자 1명으로 일치해 버린다. 즉 이 검사가 유일한 방어선이다.
		#   2. 인증서 뒤에 개인키가 붙은 파일 — 통과하고, 그러면 **복호화 수단이 서버에 남는다.**
		#      이 설계의 전제("이 호스트는 자기가 올린 것을 스스로 읽을 수 없다")가 깨진다.
		#
		# 그래서 PEM 블록을 세고 종류를 확인한다. DER 인증서는 여기서 거부되는데 의도한 것이다 —
		# `openssl smime -encrypt` 의 인증서 인자는 PEM 을 기대하고, §8-1 의 절차도 PEM 을 만든다.
		# `:-0` 인 이유: 이진 파일(DER)에서는 grep 이 개수를 내지 않고 빈 문자열이 되는 구현이 있다.
		# 그러면 아래 비교가 빈 값으로 돌아 에러 메시지가 "PEM 블록 개수" 를 비워 두게 된다.
		_n_pem="$(grep -c '^-----BEGIN ' "$_c" 2> /dev/null || true)"; _n_pem="${_n_pem:-0}"
		_n_crt="$(grep -c '^-----BEGIN CERTIFICATE-----' "$_c" 2> /dev/null || true)"; _n_crt="${_n_crt:-0}"
		[ "$_n_pem" = 1 ] && [ "$_n_crt" = 1 ] || die "인증서 파일에는 PEM 인증서 블록이 **정확히 하나**만 있어야 한다 (발견: PEM 블록 ${_n_pem}개 중 인증서 ${_n_crt}개) — 여러 수신자는 파일을 나눠 콜론으로 나열한다, 개인키는 서버에 두지 않는다: $_c"
		openssl x509 -in "$_c" -noout > /dev/null 2>&1 \
			|| die "인증서로 파싱되지 않는다: $_c"
		openssl x509 -in "$_c" -noout -checkend 0 > /dev/null 2>&1 \
			|| log "warn: 인증서가 만료됐다 — 암호화는 되지만 복원 시점에 곤란하다: $_c"
		ENV_CERTS+=("$_c")
	done < <(printf '%s\n' "$ENV_CERT" | tr ':' '\n')
	[ "${#ENV_CERTS[@]}" -gt 0 ] || die "OFFSITE_ENV_CERT 에서 사용할 인증서를 찾지 못했다: $ENV_CERT"
	log ".env 암호화 수신자 ${#ENV_CERTS[@]} 명: $(
		for _c in "${ENV_CERTS[@]}"; do
			printf '%s(%s) ' "$(basename "$_c")" \
				"$(openssl x509 -in "$_c" -noout -fingerprint -sha256 2> /dev/null | cut -d= -f2 | cut -c1-11)"
		done
	)"

	# 이름에 내용 해시를 넣는다. `.env` 는 거의 바뀌지 않으므로 **서로 다른 내용당 객체 하나**만 쌓이고,
	# 같은 내용을 매일 다시 올리지 않는다(원격 크기 비교 한 번으로 끝난다). openssl dgst 를 쓰는 이유는
	# sha256sum 이 macOS 에 없어서다 — 이 스크립트를 노트북에서 손으로 돌릴 때도 같은 이름이 나와야 한다.
	env_hash="$(openssl dgst -sha256 "$REPO_DIR/.env" | awk '{print $NF}' | cut -c1-12)"
	env_object="${ENV_PREFIX}env_${env_hash}.cms"

	tmp_env="$(mktemp)"
	openssl smime -encrypt -aes-256-cbc -binary -outform DER \
		-in "$REPO_DIR/.env" -out "$tmp_env" "${ENV_CERTS[@]}" \
		|| { rm -f "$tmp_env"; die ".env 암호화 실패 (인증서를 확인한다: $ENV_CERT)"; }

	# 수신자 수가 인증서 **경로** 수와 맞는지 확인한다.
	#
	# 이것이 잡는 것과 잡지 못하는 것을 분명히 해 둔다. 이어붙인 파일은 **잡지 못한다** — 경로 1개 /
	# 수신자 1명으로 일치하기 때문이고, 그건 위 PEM 블록 개수 검사가 담당한다. 여기서 잡는 것은
	# openssl 이 어떤 이유로든(버전 차이·인자 처리 변경·잘린 출력) 준 인증서 수보다 적은 수신자를
	# 넣은 경우다. 복원 시점에 "이 키로는 안 열린다" 를 발견하는 것보다 낫다.
	_rcpt="$(openssl cms -inform DER -cmsout -print -in "$tmp_env" 2> /dev/null | grep -c 'd.issuerAndSerialNumber')"
	if [ "$_rcpt" -ne "${#ENV_CERTS[@]}" ]; then
		rm -f "$tmp_env"
		die ".env 암호문의 수신자가 ${_rcpt} 명인데 인증서는 ${#ENV_CERTS[@]} 개다 — 일부 키로 복호화되지 않는다"
	fi

	# 평문이 그대로 올라가는 사고를 막는 마지막 관문. 이 검사가 없으면 openssl 이 버전·옵션 차이로 다른
	# 것을 내놨을 때 **시크릿을 평문으로 버킷에 올리게 된다.**
	#
	# **접두어 바이트가 아니라 DER 전체를 파싱한다.** OID 바이트열(`06092a864886f70d010703`)은 최상위
	# 콘텐츠 타입만 나타내므로, 앞부분만 보면 뒤가 잘린 파일도 통과한다(실측: 앞 200바이트만 남긴 파일이
	# 접두어 검사를 통과했고 전체 파싱에서만 걸렸다). `cms -cmsout` 은 구조를 끝까지 읽으므로 잘린 파일이
	# 거부되고, 최상위 타입이 envelopedData 인지까지 확인한다.
	assert_cms_enveloped() {
		local f="$1" what="$2"
		openssl cms -inform DER -cmsout -noout -in "$f" > /dev/null 2>&1 \
			|| { log "error: $what — CMS DER 로 파싱되지 않는다(잘렸거나 다른 형식)"; return 1; }
		openssl cms -inform DER -cmsout -print -in "$f" 2> /dev/null \
			| grep -q 'pkcs7-envelopedData' \
			|| { log "error: $what — 최상위 콘텐츠 타입이 envelopedData 가 아니다"; return 1; }
		return 0
	}
	assert_cms_enveloped "$tmp_env" "암호화 결과" \
		|| { rm -f "$tmp_env"; die "암호화 결과가 CMS envelopedData 가 아니다 — 업로드하지 않는다"; }

	env_size="$(wc -c < "$tmp_env" | tr -d ' ')"
	env_remote="$(oci os object head --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
		--name "$env_object" --query '"content-length"' --raw-output 2> /dev/null || true)"

	# `env/latest` 포인터를 **업로드했든 이미 있었든 항상** 갱신한다.
	#
	# 이름에 내용 해시를 쓰기 때문에 `.env` 가 A → B → A 로 되돌아가면 A 객체는 이미 있어 건너뛰는데
	# 그 객체의 생성 시각은 과거다. 그러면 "시각순 최신" 은 여전히 B 이고, `--verify-latest` 와 복원 절차가
	# **현재 설정이 아닌 옛 설정을 최신 백업으로 취급한다.** 포인터가 그 함정을 없앤다.
	write_env_pointer() {
		local ptr
		ptr="$(mktemp)"
		printf '%s\n' "$env_object" > "$ptr"
		if oci os object put --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
			--name "${ENV_PREFIX}latest" --file "$ptr" --force > /dev/null 2>&1; then
			rm -f "$ptr"
			log ".env 포인터 갱신: ${ENV_PREFIX}latest -> $env_object"
		else
			rm -f "$ptr"
			# 포인터 실패는 백업 자체를 무효화하지 않지만(객체는 올라갔다) 복원이 옛 것을 고를 수 있으므로
			# 알린다.
			die ".env 포인터 갱신 실패 — 복원이 옛 백업을 고를 수 있다 (${ENV_PREFIX}latest)"
		fi
	}

	if [ "$env_remote" = "$env_size" ]; then
		log ".env 백업 최신 — 업로드 건너뜀 ($env_object)"
		[ "$DRY_RUN" = true ] || write_env_pointer
	elif [ "$DRY_RUN" = true ]; then
		log "[dry-run] .env 업로드했을 것: $env_object ($env_size bytes)"
	else
		oci os object put --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$env_object" \
			--file "$tmp_env" --force > /dev/null 2>&1 || { rm -f "$tmp_env"; die ".env 업로드 실패: $env_object"; }
		env_head="$(oci os object head --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
			--name "$env_object" --query '"content-length"' --raw-output 2> /dev/null || true)"
		[ "$env_head" = "$env_size" ] \
			|| die ".env 업로드 검증 실패: $env_object (기대 $env_size, 원격 ${env_head:-없음})"
		log ".env 업로드 완료: $env_object ($env_size bytes, CMS)"
		write_env_pointer
	fi
	rm -f "$tmp_env"
fi


# ---------------------------------------------------------------------------
# 원격 보존기간 정리
# ---------------------------------------------------------------------------
# 조회를 `--prefix "$PREFIX"`(db/) 로 좁히므로 `env/` 는 **정리 대상이 아니다.** 의도된 것이다 — `.env` 는
# 몇 달씩 그대로일 수 있고, 나이로 지우면 **유일한 시크릿 사본이 만료되어 사라진다.** env/ 는 내용 해시로
# 이름을 만들어 서로 다른 내용당 하나씩만 쌓이므로 무한히 늘지 않는다.
if [ "$RETENTION_DAYS" -gt 0 ]; then
	stale="$(printf '%s' "$remote_list" | python3 -c "
import datetime, json, sys
days = int(sys.argv[1])
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
try:
    items = json.load(sys.stdin) or []
except Exception:
    items = []
for item in items:
    created = item.get('created')
    if not created:
        continue
    try:
        ts = datetime.datetime.fromisoformat(created.replace('Z', '+00:00'))
    except ValueError:
        continue
    if ts < cutoff:
        print(item['name'])
" "$RETENTION_DAYS")"
	while read -r obj; do
		[ -n "$obj" ] || continue
		if [ "$DRY_RUN" = true ]; then
			log "[dry-run] 삭제했을 것: $obj"
			continue
		fi
		if oci os object delete --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$obj" --force > /dev/null 2>&1; then
			log "보존기간 초과 삭제: $obj"
		else
			# 정리 실패는 백업 자체를 무효화하지 않는다 — 오래된 것이 남을 뿐이다. 죽이지 않고 남긴다.
			log "warn: 삭제 실패: $obj"
		fi
	done <<< "$stale"
fi

# ---------------------------------------------------------------------------
# 신선도 게이지 (#131)
# ---------------------------------------------------------------------------
# 이 스크립트는 **돌다가 실패하면** 메일을 보내지만, 타이머가 죽어 **아예 안 도는** 경우에는 아무 신호가
# 없다. 그 공백을 메우는 것이 이 게이지다 — 여기까지 도달했다는 것이 "원격 업로드가 끝났다"이고, 도달하지
# 못하면 게이지가 낡아 `OffsiteBackupStale` 이 울린다. 위의 `die` 들이 전부 이 줄 앞에 있는 것이 설계다.
#
# **쓰기 실패로 백업을 실패시키지 않는다.** 오브젝트는 이미 버킷에 있다. 관측을 못 해서 백업을 실패로
# 기록하면 이 변경이 백업을 더 약하게 만든다 — 대신 경고를 남겨 그 사실이 조용히 묻히지 않게 한다.
if [ "$DRY_RUN" = true ]; then
	log "[dry-run] 신선도 게이지를 갱신했을 것"
else
	# 볼륨 이름은 compose 프로젝트 접두어가 붙는다 — 덤프 볼륨과 같은 이유로 접미로 찾는다.
	METRICS_VOLUME="${OFFSITE_METRICS_VOLUME:-}"
	if [ -z "$METRICS_VOLUME" ]; then
		METRICS_VOLUME="$("${DOCKER[@]}" volume ls --format '{{.Name}}' | grep -E '_reputation-pool-metrics$' | head -1 || true)"
	fi
	if [ -z "$METRICS_VOLUME" ]; then
		# 조용히 넘어가지 않는다 — 게이지가 없으면 `BackupFreshnessMetricMissing` 이 울리는데, 그때
		# 원인이 이 줄이었다는 것을 로그에서 찾을 수 있어야 한다.
		log "warn: 신선도 볼륨을 찾지 못했다 (_reputation-pool-metrics) — 게이지를 갱신하지 못했다"
	else
		# 원자적 쓰기: node-exporter 는 `*.prom` 만 읽으므로 `.tmp` 에 쓴 뒤 rename 한다. 쓰는 중간을
		# 스크레이프하면 잘린 파일을 파싱하게 된다(textfile collector 의 알려진 함정).
		if {
			printf '# HELP rp_backup_remote_last_success_timestamp_seconds Unix time of the last successful offsite upload.\n'
			printf '# TYPE rp_backup_remote_last_success_timestamp_seconds gauge\n'
			printf 'rp_backup_remote_last_success_timestamp_seconds %s\n' "$(date -u +%s)"
		} | "${DOCKER[@]}" run --rm -i -v "$METRICS_VOLUME":/m alpine:3 \
			sh -c 'cat > /m/rp-backup-remote.prom.tmp && mv /m/rp-backup-remote.prom.tmp /m/rp-backup-remote.prom' \
			> /dev/null; then
			# stdout 만 버린다(docker 의 진행 출력). stderr 는 journal 로 흘려보낸다 — 실패 이유가
			# 대개 거기 있고, 그것까지 지우면 아래 warn 만 남아 원인을 다시 찾아야 한다.
			log "신선도 게이지 갱신: rp_backup_remote_last_success_timestamp_seconds"
		else
			log "warn: 신선도 게이지 갱신 실패 (업로드 자체는 성공했다)"
		fi
	fi
fi

# ---------------------------------------------------------------------------
# 최신 원격 덤프 무결성 확인 (--verify-latest)
# ---------------------------------------------------------------------------
# "복원해본 적 없는 백업은 백업이 아니다"(#15 종료 기준)의 오프사이트 판. 전체 복원까지는 하지 않지만,
# **내려받은 파일이 pg_restore 가 읽을 수 있는 아카이브인지**는 확인한다 — 업로드 손상이나 잘린 파일은
# 여기서 걸린다. 전체 복원 리허설은 RestoreRehearsalIT 가 CI 에서 돈다.
if [ "$VERIFY_LATEST" = true ]; then
	latest="$(oci os object list --namespace "$NAMESPACE" --bucket-name "$BUCKET" --prefix "$PREFIX" --all \
		--query 'sort_by(data[], &"time-created")[-1].name' --raw-output 2> /dev/null || true)"
	[ -n "$latest" ] && [ "$latest" != null ] || die "검증할 원격 덤프가 없다"
	tmpd="$(mktemp -d)"
	trap 'rm -rf "$tmpd"' EXIT
	oci os object get --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$latest" \
		--file "$tmpd/dump" > /dev/null 2>&1 || die "다운로드 실패: $latest"
	if "${DOCKER[@]}" run --rm -v "$tmpd":/v:ro postgres:17 pg_restore --list /v/dump > "$tmpd/toc" 2>&1; then
		log "무결성 확인: $latest — pg_restore 가 읽을 수 있다 (TOC $(grep -c . "$tmpd/toc") 줄)"
	else
		die "무결성 확인 실패: $latest — pg_restore 가 읽지 못한다"
	fi

	# .env 백업도 함께 본다. **복호화는 하지 않는다** — 개인키가 이 호스트에 없는 것이 설계이고, 여기서
	# 복호화할 수 있다면 그 자체가 결함이다. 그래서 "CMS envelopedData 인지" 와 "비어 있지 않은지" 만 본다
	# (평문이 올라갔거나 잘린 파일은 이 검사에서 걸린다). 실제 복호화 리허설은 노트북에서 §8-1 절차로 한다.
	# **시각순 최신이 아니라 `env/latest` 포인터를 읽는다.** 이름에 내용 해시를 쓰므로 `.env` 가
	# A → B → A 로 되돌아가면 A 객체의 생성 시각은 과거이고, 시각순 최신은 여전히 B 다 — 그걸 검증하면
	# **현재 설정이 아닌 옛 설정을 "최신 백업" 으로 확인해 주는** 셈이 된다.
	env_prefix_v="${OFFSITE_ENV_PREFIX:-env/}"
	env_latest=""
	if oci os object get --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
		--name "${env_prefix_v}latest" --file "$tmpd/latest" > /dev/null 2>&1; then
		env_latest="$(tr -d '[:space:]' < "$tmpd/latest")"
	else
		# 포인터를 쓰기 전에 올린 백업이 있을 수 있다 — 시각순으로 떨어지되 그 사실을 알린다.
		env_latest="$(oci os object list --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
			--prefix "$env_prefix_v" --all \
			--query 'sort_by(data[], &"time-created")[-1].name' --raw-output 2> /dev/null || true)"
		[ -z "$env_latest" ] || [ "$env_latest" = null ] \
			|| log "warn: ${env_prefix_v}latest 포인터가 없어 시각순으로 골랐다 — 내용이 되돌아간 경우 옛 백업일 수 있다"
	fi

	if [ -z "$env_latest" ] || [ "$env_latest" = null ]; then
		log "warn: 원격에 .env 백업이 없다 — 인스턴스 소실 시 복원 불가 (OFFSITE_ENV_CERT 설정 확인)"
	else
		oci os object get --namespace "$NAMESPACE" --bucket-name "$BUCKET" --name "$env_latest" \
			--file "$tmpd/env.cms" > /dev/null 2>&1 || die ".env 백업 다운로드 실패: $env_latest"
		[ -s "$tmpd/env.cms" ] || die ".env 백업이 비어 있다: $env_latest"
		# 업로드 측과 같은 이유로 DER 전체를 파싱한다 — 접두어만 보면 뒤가 잘린 파일이 통과한다.
		openssl cms -inform DER -cmsout -noout -in "$tmpd/env.cms" > /dev/null 2>&1 \
			|| die ".env 백업이 CMS DER 로 파싱되지 않는다(잘렸거나 손상): $env_latest"
		openssl cms -inform DER -cmsout -print -in "$tmpd/env.cms" 2> /dev/null \
			| grep -q 'pkcs7-envelopedData' \
			|| die ".env 백업의 최상위 타입이 envelopedData 가 아니다 — 평문이 올라갔을 수 있다: $env_latest"
		log "무결성 확인: $env_latest — CMS envelopedData ($(wc -c < "$tmpd/env.cms" | tr -d ' ') bytes)"
	fi
fi

log "완료"
