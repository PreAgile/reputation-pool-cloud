#!/usr/bin/env bash
# 호스트 이전 (#167 / deployment.md §11) — 데이터·시크릿·인증서·DNS 를 한 번의 실행으로 새 호스트로 옮긴다.
#
# `bootstrap.sh` 는 "빈 호스트 → 스택" 을, `backup.sh`/`restore.sh` 는 데이터를, `oci-launch-retry.sh` 는
# 인스턴스 확보를 이미 해결한다. 남은 것은 **그 부품들을 옳은 순서로 엮고, 전환 전에 검증하고, 되돌릴
# 근거를 남기는 것**이다. 이 스크립트가 그 층이다.
#
# ## 왜 필요한가
# 지금 프로덕션은 크레딧으로 도는 x86 이고 `a1-hunter.service` 가 Always Free A1 을 24시간 사냥한다.
# 용량이 열리는 순간은 예측할 수 없으므로, 그때 손으로 옮기면 **현재 호스트의 드리프트가 그대로
# 복제된다**(실측 2026-08-05: 자동 배포 타이머는 설치돼 있었지만 `/tmp` 의 root 소유 잠금 파일 때문에
# 5분마다 발화해 5분마다 죽고 있었고, 그 상태가 21시간 이어져 도는 이미지가 레포 HEAD 보다 뒤처져
# 있었다. 실패는 journal 에만 남아 아무도 보지 않았다). 그래서 이전은 "문서를 따라가는 수작업" 이 아니라
# **호스트의 성질까지 복원하고, 복원됐는지 확인하는 스크립트**여야 한다.
#
# ## 순서 원칙 — 되돌릴 수 없는 일을 마지막에
#   Phase 0  사전 점검      아무것도 바꾸지 않는다 (--dry-run 은 여기서 끝난다)
#   Phase 1  반출            구 호스트 app 만 freeze → 덤프 → .env → caddy-data 볼륨
#   Phase 2  기동            신규 호스트: 볼륨 먼저 복원 → bootstrap → DB 복원 → 타이머 설치
#   Phase 3  검증            DNS 를 건드리지 않고 --resolve 로 신규 오리진 직접 검증 + 행수 대조
#   Phase 4  전환            Cloudflare A 레코드 content 만 PATCH (proxied 유지)
#   Phase 5  마무리          구 호스트 타이머 정지 → 컨테이너 정지 (삭제는 --decommission)
# 사용자에게 보이는 순간은 Phase 4 뿐이고, 그 앞은 전부 라이브 트래픽과 무관하게 끝난다.
#
# ## 반드시 지키는 세 가지
# 1. **DB 는 논리 덤프로만 옮긴다.** x86 → arm64 이전에서 PGDATA 볼륨을 그대로 복사하면 Postgres 가
#    뜨지 못한다(데이터 디렉터리는 아키텍처·빌드 의존). `pg_dump -Fc` → `pg_restore` 만 쓴다.
#    반대로 `caddy-data` 는 평범한 파일(인증서·ACME 계정)이라 볼륨째 옮겨도 안전하다.
# 2. **인증서를 들고 간다.** 신규 호스트는 DNS 가 자기를 가리키기 전에 ACME(HTTP-01)로 인증서를 받을 수
#    없고, Cloudflare 는 Full(strict) 이라 오리진 인증서가 유효하지 않으면 거부한다. 그대로 전환하면
#    526/502 창이 생기고 **전환 전 검증조차 불가능**하다. `caddy-data` 를 먼저 복원해 유효한 인증서를
#    들고 부팅하면 Phase 3 에서 실제 TLS 검증까지 끝낼 수 있다.
# 3. **끄는 순서.** Phase 5 는 타이머를 **먼저** 끈다. 안 끄면 구 호스트가 계속 자동 배포를 시도하고,
#    최악으로는 오프사이트 버킷에 옛 데이터를 최신 이름으로 덮어쓴다 — 백업이 스스로를 오염시키는
#    사고는 조용히 일어나 몇 주 뒤에 발견된다.
#
# ## 사용 (노트북에서)
#   ./scripts/migrate-host.sh --to <신규IP> --dry-run          # 점검만 (안전, 몇 번이든)
#   ./scripts/migrate-host.sh --to <신규IP>                    # Phase 0~5. 단계 마커를 남겨 재실행은 이어서 진행
#   ./scripts/migrate-host.sh --to <신규IP> --workdir migration-…   # 중단된 작업 재개
#   ./scripts/migrate-host.sh --rollback migration-…           # DNS 를 되돌리고 구 호스트를 다시 올린다
#   ./scripts/migrate-host.sh --decommission migration-…       # 구 인스턴스 종료(가드 3개를 통과해야)
#
# 환경변수: MIGRATE_SSH_USER(기본 ubuntu) · MIGRATE_OLD_HOST(기본: CF 의 app 레코드에서 산출)
#           MIGRATE_REPO_DIR(기본 /home/<user>/reputation-pool-cloud) · MIGRATE_REPO_URL · CF_ZONE
# 전제: `cf-dns.sh` 가 쓰는 CF_API_TOKEN, 구·신 호스트 SSH 키, (--decommission 만) OCI CLI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s %s\n' "$(ts)" "$1"; }
step() { printf '\n%s ==> %s\n' "$(ts)" "$1"; }
die() { printf '%s error: %s\n' "$(ts)" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 인자 — 네트워크·SSH 보다 **먼저** 검증한다 (CI 가 이 부분을 실제로 실행한다)
# ---------------------------------------------------------------------------
MODE=forward
NEW_IP=""
WORKDIR=""
DRY_RUN=false

usage() {
	printf 'usage: %s --to <신규IP> [--dry-run] [--workdir <경로>]\n' "$(basename "$0")" >&2
	printf '       %s (--rollback | --decommission) <작업디렉터리>\n' "$(basename "$0")" >&2
	exit 2
}

while [ $# -gt 0 ]; do
	case "$1" in
		--to)
			NEW_IP="${2:-}"
			[ -n "$NEW_IP" ] || { printf 'error: --to 에 신규 호스트 IP 가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--workdir)
			WORKDIR="${2:-}"
			[ -n "$WORKDIR" ] || { printf 'error: --workdir 에 경로가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--rollback)
			MODE=rollback
			WORKDIR="${2:-}"
			[ -n "$WORKDIR" ] || { printf 'error: --rollback 에 작업디렉터리가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--decommission)
			MODE=decommission
			WORKDIR="${2:-}"
			[ -n "$WORKDIR" ] || { printf 'error: --decommission 에 작업디렉터리가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--dry-run) DRY_RUN=true ;;
		-h | --help) usage ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
	esac
	shift
done

valid_ipv4() {
	local ip="$1" a b c d o
	[[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
	IFS=. read -r a b c d <<< "$ip"
	for o in "$a" "$b" "$c" "$d"; do
		[ "$o" -le 255 ] || return 1
	done
	return 0
}

case "$MODE" in
	forward)
		[ -n "$NEW_IP" ] || usage
		valid_ipv4 "$NEW_IP" || die "--to 가 IPv4 주소가 아니다: $NEW_IP"
		;;
	rollback | decommission)
		[ -d "$WORKDIR" ] || die "작업디렉터리가 없다: $WORKDIR"
		[ "$DRY_RUN" = false ] || log "warn: --dry-run 은 $MODE 에서 무시된다"
		;;
esac

CF_DNS="$REPO_ROOT/scripts/cf-dns.sh"
[ -x "$CF_DNS" ] || die "cf-dns.sh 를 실행할 수 없다: $CF_DNS"

for tool in ssh curl python3 tar; do
	command -v "$tool" > /dev/null 2>&1 || die "$tool 이 없다"
done

SSH_USER="${MIGRATE_SSH_USER:-ubuntu}"
REPO_DIR="${MIGRATE_REPO_DIR:-/home/$SSH_USER/reputation-pool-cloud}"
REPO_URL="${MIGRATE_REPO_URL:-https://github.com/PreAgile/reputation-pool-cloud.git}"
ZONE="${CF_ZONE:-poolroost.com}"

# StrictHostKeyChecking=accept-new: 신규 인스턴스는 호스트 키가 known_hosts 에 없다. `no` 로 낮추지
# 않는 이유는 그러면 **이미 아는 호스트의 키가 바뀌어도** 통과해 MITM 을 놓친다는 것 —
# `accept-new` 는 처음 보는 키만 받고 변경은 여전히 거부한다.
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)

# `-n`(stdin 을 /dev/null 로) 이 기본인 이유: ssh 는 기본적으로 stdin 을 **읽어 원격으로 보낸다.** 그러면
# 이 스크립트의 stdin 이 원격 명령에 먹혀 `read -r answer`(--decommission 의 확인 문구)가 즉시 EOF 를 받고,
# 루프 안에서 부르면 그 루프의 입력까지 사라진다. 실제로 스트림을 보내야 하는 세 곳만 on_host_stdin 을 쓴다.
on_host() {
	local host="$1"
	shift
	# SC2029: 클라이언트 쪽 확장이 **의도**다. 원격 명령 문자열은 여기(노트북)에서 $DOCKER_OLD·$REPO_DIR·
	# 볼륨 이름 같은 로컬에서 판정한 값으로 조립한다 — 원격에는 그 변수가 존재하지 않는다.
	# shellcheck disable=SC2029
	ssh -n "${SSH_OPTS[@]}" "$SSH_USER@$host" "$@"
}

# stdin 을 원격 명령에 그대로 흘려보낸다(.env·caddy-data·덤프 업로드 전용).
on_host_stdin() {
	local host="$1"
	shift
	# shellcheck disable=SC2029
	ssh "${SSH_OPTS[@]}" "$SSH_USER@$host" "$@"
}

# ---------------------------------------------------------------------------
# 작업 디렉터리 — 단계 마커·스냅샷·반출물이 여기 모인다
# ---------------------------------------------------------------------------
if [ "$MODE" = forward ]; then
	WORKDIR="${WORKDIR:-migration-$(date -u '+%Y%m%dT%H%M%SZ')}"
	mkdir -p "$WORKDIR/state"
	chmod 700 "$WORKDIR"
fi

phase_done() { [ -f "$WORKDIR/state/phase$1.ok" ]; }
mark_done() {
	printf '%s\n' "$(ts)" > "$WORKDIR/state/phase$1.ok"
	log "phase $1 완료"
}

# 구 호스트 IP. 지정하지 않으면 **Cloudflare 가 지금 가리키는 곳**에서 얻는다 — 사람이 기억하는 IP 를
# 받는 것보다 정확하다.
#
# 기록된 값을 CF 조회보다 앞에 두는 이유: Phase 4(전환) 이후 재개하면 CF 는 이미 신규 IP 를 돌려주므로
# "구 호스트 = 신규 호스트" 가 되어 Phase 5 로 넘어갈 수 없다. 이전이 시작된 뒤의 진실은 작업 디렉터리에 있다.
resolve_old_ip() {
	local out
	if [ -n "${MIGRATE_OLD_HOST:-}" ]; then
		printf '%s' "$MIGRATE_OLD_HOST"
		return 0
	fi
	if [ -s "$WORKDIR/old-ip" ]; then
		tr -d '[:space:]' < "$WORKDIR/old-ip"
		return 0
	fi
	out="$("$CF_DNS" --list 2> /dev/null | awk -v want="app.$ZONE" '$1 == want { print $2; exit }')"
	[ -n "$out" ] || return 1
	printf '%s' "$out"
}

# 원격에서 docker 를 어떻게 부를지 한 번만 정한다(bootstrap.sh 와 같은 판정).
resolve_docker() {
	local host="$1"
	if on_host "$host" 'docker info > /dev/null 2>&1'; then
		printf 'docker'
	elif on_host "$host" 'sudo -n docker info > /dev/null 2>&1'; then
		printf 'sudo docker'
	else
		die "$host 에서 docker 를 쓸 수 없다 (docker 그룹 또는 비밀번호 없는 sudo 가 필요하다)"
	fi
}

# 볼륨 이름에는 compose 프로젝트 접두어가 붙는다(호스트마다 다를 수 있다). 접미로 찾는다 —
# 박아 두면 다른 호스트에서 조용히 빈 볼륨을 만진다(backup-offsite.sh 와 같은 이유).
find_volume() {
	local host="$1" dockercmd="$2" suffix="$3" out
	out="$(on_host "$host" "$dockercmd volume ls --format '{{.Name}}'" | grep -E "$suffix\$" | head -1 || true)"
	printf '%s' "$out"
}

ROWCOUNT_SQL="select 'tenant='||count(*) from tenant union all select 'api_key='||count(*) from api_key union all select 'registered_resource='||count(*) from registered_resource union all select 'cell='||count(*) from cell union all select 'cell_outcome='||count(*) from cell_outcome"

row_counts() {
	local host="$1" dockercmd="$2"
	on_host "$host" "$dockercmd exec reputation-pool-db psql -U reputation_pool -d reputation_pool -tA -c \"$ROWCOUNT_SQL\"" \
		| tr -d ' \r' | sort
}

# ---------------------------------------------------------------------------
# 롤백 — DNS 를 스냅샷대로 되돌리고 구 호스트를 다시 올린다
# ---------------------------------------------------------------------------
if [ "$MODE" = rollback ]; then
	SNAP="$WORKDIR/dns-before.json"
	OLD_IP="$(cat "$WORKDIR/old-ip" 2> /dev/null || true)"
	[ -n "$OLD_IP" ] || die "$WORKDIR/old-ip 가 없다 — 이 디렉터리가 이전 작업의 것인지 확인한다"

	step "구 호스트 재기동 ($OLD_IP)"
	# bootstrap 을 부르기 전에 docker 도달성을 먼저 확인한다 — SSH 는 되는데 docker 권한이 없는 상태에서
	# bootstrap 이 중간까지 진행하면 롤백이 반쯤 된 채로 멈춘다.
	DOCKER_OLD="$(resolve_docker "$OLD_IP")"
	log "docker 도달 확인 ($DOCKER_OLD)"
	# bootstrap.sh 는 멱등이라 재실행이 곧 재배포다. 컨테이너를 개별로 start 하지 않는 이유:
	# Phase 5 이후 이미지·설정이 바뀌었을 수 있고, 그 경우 stale 한 조합으로 뜬다.
	on_host "$OLD_IP" "cd $REPO_DIR && ./scripts/bootstrap.sh" || die "구 호스트 bootstrap 실패 — 수동 개입이 필요하다"

	# Phase 5 가 실제로 끈 유닛만 정확히 되살린다. 이름을 박아 두면(호스트마다 다를 수 있다) 조용히
	# 아무것도 켜지 않고 "롤백 완료" 로 끝난다 — 자동 배포·백업이 죽은 채 남는 것이 최악이다.
	if [ -s "$WORKDIR/old-timers.txt" ]; then
		log "타이머 재활성"
		while read -r unit; do
			[ -n "$unit" ] || continue
			on_host "$OLD_IP" "sudo systemctl enable --now $unit" \
				|| log "warn: $unit 재활성 실패 — 직접 확인한다"
			printf '  %s\n' "$unit"
		done < "$WORKDIR/old-timers.txt"
	else
		log "warn: $WORKDIR/old-timers.txt 가 없다 — 타이머 상태를 직접 확인한다 (systemctl list-timers)"
	fi

	if [ -f "$SNAP" ]; then
		step "DNS 복원 ($SNAP)"
		"$CF_DNS" --restore "$SNAP" || die "DNS 복원 실패 — cf-dns.sh --list 로 현재 상태를 확인한다"
	else
		log "warn: $SNAP 이 없다 — DNS 는 아직 전환되지 않았던 것으로 보고 건너뛴다"
	fi

	step "엣지 경유 확인"
	for attempt in $(seq 1 12); do
		if curl -fsS --max-time 10 "https://app.$ZONE/actuator/health" > /dev/null 2>&1; then
			log "헬스 OK (https://app.$ZONE/actuator/health)"
			break
		fi
		[ "$attempt" -lt 12 ] || die "롤백 후에도 엣지 경유 헬스가 실패한다 — 수동 확인이 필요하다"
		sleep 5
	done

	rm -f "$WORKDIR/state/phase4.ok" "$WORKDIR/state/phase5.ok"
	log "롤백 완료 — 구 호스트로 되돌렸다. 신규 호스트는 그대로 남아 있다(다시 시도 가능)"
	exit 0
fi

# ---------------------------------------------------------------------------
# 폐기 — 가드 세 개를 통과해야 구 인스턴스를 종료한다
# ---------------------------------------------------------------------------
if [ "$MODE" = decommission ]; then
	OLD_IP="$(cat "$WORKDIR/old-ip" 2> /dev/null || true)"
	NEW_IP="$(cat "$WORKDIR/new-ip" 2> /dev/null || true)"
	[ -n "$OLD_IP" ] && [ -n "$NEW_IP" ] || die "$WORKDIR 에 old-ip/new-ip 가 없다"
	command -v oci > /dev/null 2>&1 || die "oci CLI 가 없다 — brew install oci-cli"

	step "가드 1 — DNS 가 신규 호스트를 가리키는가"
	# 이것이 가장 중요한 가드다. 아직 구 호스트를 가리키는 상태에서 인스턴스를 종료하면 그 순간이 곧 장애다.
	"$CF_DNS" --check "$NEW_IP" > /dev/null || die "DNS 가 아직 $NEW_IP 를 가리키지 않는다 — 종료하지 않는다"
	if "$CF_DNS" --check "$OLD_IP" > /dev/null 2>&1; then
		die "아직 $OLD_IP 를 가리키는 A 레코드가 있다 — 종료하지 않는다"
	fi
	log "DNS 는 신규 호스트만 가리킨다"

	step "가드 2 — 신규 호스트의 오프사이트 백업이 살아 있는가"
	DOCKER_NEW="$(resolve_docker "$NEW_IP")"
	on_host "$NEW_IP" 'systemctl is-enabled rp-backup-offsite.timer > /dev/null 2>&1' \
		|| die "신규 호스트에 rp-backup-offsite.timer 가 없다 — 백업 없는 단일 호스트를 만들 수 없다"
	NEW_ROWS="$(row_counts "$NEW_IP" "$DOCKER_NEW")"
	printf '%s\n' "$NEW_ROWS" | sed 's/^/  /'
	printf '%s' "$NEW_ROWS" | grep -q '^cell=[1-9]' || die "신규 호스트의 cell 이 0 건이다 — 데이터가 없다"

	step "가드 3 — 사람의 확인"
	printf '  구 인스턴스를 종료한다. 부트 볼륨은 보존하지 않는다.\n'
	printf '  되돌릴 방법은 이 시점 이후 없다. 계속하려면 TERMINATE 를 입력한다: '
	read -r answer
	[ "$answer" = "TERMINATE" ] || die "확인 문구가 일치하지 않는다 — 중단한다"

	INSTANCE_ID="$(cat "$WORKDIR/old-instance-id" 2> /dev/null || true)"
	[ -n "$INSTANCE_ID" ] \
		|| die "구 인스턴스 OCID 를 모른다 — $WORKDIR/old-instance-id 에 넣거나 콘솔에서 종료한다"

	step "인스턴스 종료 ($INSTANCE_ID)"
	# --preserve-boot-volume 을 명시한다. 기본값에 의존하면 CLI 가 기본을 바꿀 때 위 확인 문구("보존하지
	# 않는다")와 실제 동작이 조용히 어긋난다. 덤프는 작업 디렉터리에 남아 있으므로 지우는 쪽을 고른다.
	oci compute instance terminate --instance-id "$INSTANCE_ID" --preserve-boot-volume false --force \
		|| die "종료 실패 — 콘솔에서 확인한다"
	log "폐기 완료. $WORKDIR 의 덤프·스냅샷은 남겨 둔다(감사 추적)"
	exit 0
fi

# ---------------------------------------------------------------------------
# Phase 0 — 사전 점검 (아무것도 바꾸지 않는다)
# ---------------------------------------------------------------------------
step "Phase 0 — 사전 점검"

OLD_IP="$(resolve_old_ip)" || die "구 호스트 IP 를 알 수 없다 — MIGRATE_OLD_HOST 로 지정하거나 cf-dns.sh --list 를 확인한다"
valid_ipv4 "$OLD_IP" || die "구 호스트 IP 가 IPv4 로 보이지 않는다: $OLD_IP"
[ "$OLD_IP" != "$NEW_IP" ] || die "구 호스트와 신규 호스트가 같다 ($OLD_IP) — 이미 전환된 상태일 수 있다"
printf '%s\n' "$OLD_IP" > "$WORKDIR/old-ip"
printf '%s\n' "$NEW_IP" > "$WORKDIR/new-ip"

log "구 호스트 $OLD_IP → 신규 호스트 $NEW_IP (작업 디렉터리 $WORKDIR)"

# 전환이 이미 끝난 뒤의 재개에서는 구 IP 를 가리키는 레코드가 없는 것이 **정상**이다 — 그때 이 확인을
# 그대로 돌리면 exit 3 으로 죽어 Phase 5 를 마칠 수 없다.
if phase_done 4; then
	log "phase 4 가 이미 끝났다 — 전환 대상 확인을 건너뛴다"
else
	step "전환 대상 A 레코드"
	"$CF_DNS" --check "$OLD_IP" || die "전환 대상을 확인할 수 없다 (구 오리진 IP 가 맞는지 확인한다)"
fi

step "구 호스트 점검"
DOCKER_OLD="$(resolve_docker "$OLD_IP")"
on_host "$OLD_IP" "test -f $REPO_DIR/.env" || die "구 호스트에 $REPO_DIR/.env 가 없다"
BACKUP_VOL="$(find_volume "$OLD_IP" "$DOCKER_OLD" '_reputation-pool-backups')"
CADDY_VOL="$(find_volume "$OLD_IP" "$DOCKER_OLD" '_caddy-data')"
[ -n "$BACKUP_VOL" ] || die "구 호스트에서 백업 볼륨을 찾지 못했다"
[ -n "$CADDY_VOL" ] || die "구 호스트에서 caddy-data 볼륨을 찾지 못했다 (인증서를 옮길 수 없다)"
OLD_ARCH="$(on_host "$OLD_IP" 'uname -m')"
printf '  arch %s · backups=%s · caddy=%s\n' "$OLD_ARCH" "$BACKUP_VOL" "$CADDY_VOL"

step "신규 호스트 점검"
DOCKER_NEW="$(resolve_docker "$NEW_IP")"
NEW_ARCH="$(on_host "$NEW_IP" 'uname -m')"
NEW_MEM="$(on_host "$NEW_IP" "awk '/MemTotal/ {printf \"%.1fGB\", \$2/1048576}' /proc/meminfo")"
NEW_DISK="$(on_host "$NEW_IP" "df -h / | awk 'NR==2 {print \$4\" free\"}'")"
printf '  arch %s · mem %s · disk %s\n' "$NEW_ARCH" "$NEW_MEM" "$NEW_DISK"
on_host "$NEW_IP" 'command -v git > /dev/null 2>&1' \
	|| die "신규 호스트에 git 이 없다 — sudo apt-get install -y git 후 다시 실행한다"

# 아키텍처가 다르면 PGDATA 를 그대로 옮길 수 없다. 이 스크립트는 항상 논리 덤프를 쓰므로 문제가 없지만,
# 손으로 볼륨을 복사하려는 유혹이 생기는 지점이라 명시적으로 남긴다.
if [ "$OLD_ARCH" != "$NEW_ARCH" ]; then
	log "arch 가 다르다 ($OLD_ARCH -> $NEW_ARCH) — DB 는 논리 덤프로만 옮긴다(PGDATA 볼륨 복사 금지)"
fi

{
	printf 'old_ip=%s\nnew_ip=%s\nold_arch=%s\nnew_arch=%s\n' "$OLD_IP" "$NEW_IP" "$OLD_ARCH" "$NEW_ARCH"
	printf 'backup_volume=%s\ncaddy_volume=%s\nzone=%s\nrepo_dir=%s\n' \
		"$BACKUP_VOL" "$CADDY_VOL" "$ZONE" "$REPO_DIR"
} > "$WORKDIR/plan.txt"

if [ "$DRY_RUN" = true ]; then
	step "--dry-run: 여기서 멈춘다 (아무것도 바꾸지 않았다)"
	cat "$WORKDIR/plan.txt" | sed 's/^/  /'
	printf '\n  이어서 실제 이전: %s --to %s --workdir %s\n' "$0" "$NEW_IP" "$WORKDIR"
	exit 0
fi
mark_done 0

# ---------------------------------------------------------------------------
# Phase 1 — 반출
# ---------------------------------------------------------------------------
# freeze 를 쓰는 이유: 덤프 이후 전환까지 구 호스트에 들어온 보고는 유실된다. 스크래퍼의 리포터는
# best-effort 계약(서버가 죽어도 스크래핑 무영향)이라 **잠깐의 다운타임을 데이터 일관성으로 바꿔 쓸 수
# 있다** — 논리 복제나 이중 쓰기 없이 무손실이 되는 것이 이 성질 덕분이다.
FREEZE_ACTIVE=false
unfreeze() {
	if [ "$FREEZE_ACTIVE" = true ]; then
		FREEZE_ACTIVE=false
		log "구 호스트 app 재기동(freeze 해제)"
		on_host "$OLD_IP" "$DOCKER_OLD start reputation-pool-app" > /dev/null 2>&1 \
			|| log "warn: app 재기동 실패 — 구 호스트를 직접 확인한다"
	fi
}
trap unfreeze EXIT

if phase_done 1; then
	log "phase 1 이미 완료 — 건너뛴다"
else
	step "Phase 1 — 반출 (구 호스트 app 을 잠시 멈춘다)"
	on_host "$OLD_IP" "$DOCKER_OLD stop reputation-pool-app" > /dev/null || die "app 정지 실패"
	FREEZE_ACTIVE=true

	log "덤프 생성"
	on_host "$OLD_IP" "$DOCKER_OLD exec reputation-pool-backup /usr/local/bin/backup.sh" \
		| sed 's/^/  /' || die "덤프 생성 실패"

	# 볼륨 안에서 가장 최근 덤프의 이름과 크기를 한 번에 얻는다.
	# shellcheck disable=SC2016
	DUMP_LINE="$(on_host "$OLD_IP" "$DOCKER_OLD run --rm -v $BACKUP_VOL:/b:ro alpine:3 sh -c 'cd /b && f=\$(ls -1t *.dump | head -1) && printf \"%s %s\" \"\$f\" \"\$(stat -c %s \"\$f\")\"'")"
	DUMP_NAME="${DUMP_LINE%% *}"
	DUMP_SIZE="${DUMP_LINE##* }"
	[ -n "$DUMP_NAME" ] || die "볼륨에 덤프가 없다"
	log "덤프 $DUMP_NAME ($DUMP_SIZE bytes)"

	on_host "$OLD_IP" "$DOCKER_OLD run --rm -v $BACKUP_VOL:/b:ro alpine:3 cat /b/$DUMP_NAME" \
		> "$WORKDIR/$DUMP_NAME" || die "덤프를 꺼내지 못했다"
	# 꺼낸 크기가 볼륨의 크기와 다르면 멈춘다 — 잘린 덤프로 복원하는 것이 최악이다(backup-offsite.sh 와 같은 규율).
	GOT="$(wc -c < "$WORKDIR/$DUMP_NAME" | tr -d ' ')"
	[ "$GOT" = "$DUMP_SIZE" ] || die "덤프 크기가 다르다 (볼륨 $DUMP_SIZE, 받은 값 $GOT)"
	printf '%s\n' "$DUMP_NAME" > "$WORKDIR/dump-name"

	log "행수 기록 (freeze 중 — Phase 3 의 대조 기준이 된다)"
	row_counts "$OLD_IP" "$DOCKER_OLD" > "$WORKDIR/rowcounts-old.txt" || die "행수를 세지 못했다"
	sed 's/^/  /' "$WORKDIR/rowcounts-old.txt"

	log ".env 반출"
	on_host "$OLD_IP" "cat $REPO_DIR/.env" > "$WORKDIR/env" || die ".env 를 가져오지 못했다"
	chmod 600 "$WORKDIR/env"
	grep -q '^REPUTATION_POOL_DB_PASSWORD=' "$WORKDIR/env" \
		|| die "반출한 .env 에 REPUTATION_POOL_DB_PASSWORD 가 없다 — 잘린 파일로 보인다"

	log "caddy-data 볼륨 반출 (인증서·ACME 계정)"
	on_host "$OLD_IP" "$DOCKER_OLD run --rm -v $CADDY_VOL:/v:ro alpine:3 tar czf - -C /v ." \
		> "$WORKDIR/caddy-data.tgz" || die "caddy-data 를 꺼내지 못했다"
	# 아카이브가 열리는지 + 인증서가 실제로 들어 있는지 본다. tar 가 성공했다는 말과 인증서를 들고 간다는
	# 말은 다르다 — 여기서 놓치면 Phase 3 에서 TLS 검증이 실패하고 원인을 한참 찾는다.
	tar tzf "$WORKDIR/caddy-data.tgz" > "$WORKDIR/caddy-data.list" 2>/dev/null \
		|| die "caddy-data 아카이브를 열 수 없다"
	grep -q 'certificates/' "$WORKDIR/caddy-data.list" \
		|| die "caddy-data 에 certificates/ 가 없다 — 인증서 없이 전환하면 526 창이 생긴다"
	log "인증서 확인 ($(grep -c 'certificates/' "$WORKDIR/caddy-data.list") 항목)"

	unfreeze
	mark_done 1
fi
unfreeze

# ---------------------------------------------------------------------------
# Phase 2 — 신규 호스트 기동
# ---------------------------------------------------------------------------
if phase_done 2; then
	log "phase 2 이미 완료 — 건너뛴다"
else
	step "Phase 2 — 신규 호스트 기동"
	DUMP_NAME="$(cat "$WORKDIR/dump-name")"

	log "레포 준비"
	on_host "$NEW_IP" "test -d $REPO_DIR/.git || git clone --quiet $REPO_URL $REPO_DIR" \
		|| die "레포 clone 실패"
	on_host "$NEW_IP" "cd $REPO_DIR && git fetch --quiet origin && git checkout --quiet main && git reset --hard --quiet origin/main" \
		|| die "레포 최신화 실패"

	log ".env 배치"
	on_host_stdin "$NEW_IP" "cat > $REPO_DIR/.env && chmod 600 $REPO_DIR/.env" < "$WORKDIR/env" \
		|| die ".env 업로드 실패"

	# compose 프로젝트 이름은 디렉터리 이름에서 온다. 볼륨을 **bootstrap 보다 먼저** 만들어 인증서를 넣어
	# 두면 Caddy 가 유효한 인증서를 들고 처음 뜬다(ACME 시도조차 하지 않는다).
	PROJECT="$(on_host "$NEW_IP" "basename $REPO_DIR")"
	NEW_CADDY_VOL="${PROJECT}_caddy-data"
	log "caddy-data 복원 → $NEW_CADDY_VOL"
	on_host "$NEW_IP" "$DOCKER_NEW volume create $NEW_CADDY_VOL" > /dev/null || die "볼륨 생성 실패"
	on_host_stdin "$NEW_IP" "$DOCKER_NEW run --rm -i -v $NEW_CADDY_VOL:/v alpine:3 tar xzf - -C /v" \
		< "$WORKDIR/caddy-data.tgz" || die "caddy-data 복원 실패"

	log "bootstrap.sh 실행 (오버레이는 .env 의 DEPLOY_OVERLAYS 를 따른다)"
	on_host "$NEW_IP" "cd $REPO_DIR && ./scripts/bootstrap.sh" || die "bootstrap 실패"

	# Caddy 가 실제로 우리가 복원한 볼륨을 쓰는지 확인한다. 프로젝트 이름을 잘못 짚으면 compose 가
	# 다른 볼륨을 새로 만들어 붙이는데, 그 경우 인증서가 없는 채로 조용히 뜬다.
	on_host "$NEW_IP" "$DOCKER_NEW inspect reputation-pool-caddy --format '{{range .Mounts}}{{.Name}} {{end}}'" \
		| grep -q "$NEW_CADDY_VOL" \
		|| die "caddy 컨테이너가 $NEW_CADDY_VOL 을 쓰지 않는다 — 프로젝트 이름을 확인한다"
	on_host "$NEW_IP" "$DOCKER_NEW exec reputation-pool-caddy sh -c 'ls /data/caddy/certificates > /dev/null 2>&1'" \
		|| die "caddy 컨테이너 안에 인증서가 없다"
	log "caddy 가 복원된 인증서를 쓰고 있다"

	log "DB 복원 ($DUMP_NAME)"
	NEW_BACKUP_VOL="$(find_volume "$NEW_IP" "$DOCKER_NEW" '_reputation-pool-backups')"
	[ -n "$NEW_BACKUP_VOL" ] || die "신규 호스트에서 백업 볼륨을 찾지 못했다"
	on_host_stdin "$NEW_IP" "$DOCKER_NEW run --rm -i -v $NEW_BACKUP_VOL:/b alpine:3 tee /b/$DUMP_NAME > /dev/null" \
		< "$WORKDIR/$DUMP_NAME" || die "덤프 업로드 실패"
	on_host "$NEW_IP" "$DOCKER_NEW exec reputation-pool-backup /usr/local/bin/restore.sh /backups/$DUMP_NAME" \
		| sed 's/^/  /' || die "DB 복원 실패"

	# 호스트의 성질까지 복원한다. 이 단계를 빼면 지금 구 호스트에 있는 것과 똑같은 드리프트가
	# (선언은 켜져 있는데 타이머가 없는 상태) 새 호스트에 재생산된다.
	log "타이머 설치 (자동배포 · 오프사이트 백업)"
	on_host "$NEW_IP" "cd $REPO_DIR && ./scripts/install-pull-deploy.sh" | sed 's/^/  /' \
		|| log "warn: install-pull-deploy.sh 실패 — 수동 설치가 필요하다"
	on_host "$NEW_IP" "cd $REPO_DIR && ./scripts/backup-offsite.sh --install" | sed 's/^/  /' \
		|| log "warn: backup-offsite --install 실패 — 인스턴스 프린시펄 정책을 확인한다"

	mark_done 2
fi

# ---------------------------------------------------------------------------
# Phase 3 — 검증 (DNS 는 아직 구 호스트를 가리킨다)
# ---------------------------------------------------------------------------
if phase_done 3; then
	log "phase 3 이미 완료 — 건너뛴다"
else
	step "Phase 3 — 전환 전 검증 (라이브 트래픽 무영향)"

	# --resolve 로 엣지를 우회해 신규 오리진에 직접 붙는다. 인증서를 들고 왔으므로 TLS 검증까지 통과해야
	# 한다 — 여기서 통과하면 "전환해 봐야 되는지 안다" 가 "전환 전에 이미 안다" 로 바뀐다.
	for path in /actuator/health /login; do
		code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
			--resolve "app.$ZONE:443:$NEW_IP" "https://app.$ZONE$path" 2>&1)" \
			|| die "신규 오리진 직접 검증 실패 ($path) — 인그레스가 노트북 IP 를 막고 있는지도 확인한다"
		case "$code" in
			200 | 30[12] | 307 | 308) log "직접 검증 OK  $path -> $code" ;;
			*) die "직접 검증 실패 ($path -> $code)" ;;
		esac
	done

	# gRPC 데이터 플레인. 평문 GET 이라 앱이 어떤 코드를 주든 상관없다 — 확인하려는 것은 **TLS 가 검증되고
	# Caddy 의 grpc 라우팅이 h2c 백엔드까지 닿는다**는 것이다. 연결 자체가 실패하면 curl 이 비어 있다.
	grpc_code="$(curl -sS --http2 -o /dev/null -w '%{http_code}' --max-time 15 \
		--resolve "grpc.$ZONE:443:$NEW_IP" "https://grpc.$ZONE/" 2>&1)" \
		|| die "grpc.$ZONE 직접 검증 실패 — 인증서나 Caddy grpc 블록을 확인한다"
	log "gRPC 엔드포인트 응답 코드 $grpc_code (TLS·라우팅 확인)"

	step "행수 대조 (freeze 시점의 구 호스트 = 복원된 신규 호스트)"
	row_counts "$NEW_IP" "$DOCKER_NEW" > "$WORKDIR/rowcounts-new.txt" || die "신규 호스트 행수를 세지 못했다"
	if diff -u "$WORKDIR/rowcounts-old.txt" "$WORKDIR/rowcounts-new.txt"; then
		log "행수 일치 — 복원이 온전하다"
	else
		die "행수가 다르다 — 복원을 확인한다 (DNS 는 아직 구 호스트를 가리키므로 라이브 영향은 없다)"
	fi

	mark_done 3
fi

# ---------------------------------------------------------------------------
# Phase 4 — DNS 전환
# ---------------------------------------------------------------------------
if phase_done 4; then
	log "phase 4 이미 완료 — 건너뛴다"
else
	step "Phase 4 — DNS 전환 ($OLD_IP -> $NEW_IP)"
	"$CF_DNS" --switch "$OLD_IP" "$NEW_IP" --snapshot "$WORKDIR/dns-before.json" \
		|| die "DNS 전환 실패 — cf-dns.sh --list 로 현재 상태를 확인한다"

	step "엣지 경유 확인"
	for attempt in $(seq 1 12); do
		if curl -fsS --max-time 10 "https://app.$ZONE/actuator/health" > /dev/null 2>&1; then
			log "엣지 경유 헬스 OK"
			break
		fi
		if [ "$attempt" -eq 12 ]; then
			log "엣지 경유 헬스 실패 — 되돌린다"
			"$CF_DNS" --restore "$WORKDIR/dns-before.json" || log "warn: 자동 복원도 실패했다"
			die "전환 후 헬스 실패로 DNS 를 되돌렸다"
		fi
		sleep 5
	done

	mark_done 4
fi

# ---------------------------------------------------------------------------
# Phase 5 — 마무리
# ---------------------------------------------------------------------------
if phase_done 5; then
	log "phase 5 이미 완료 — 건너뛴다"
else
	step "Phase 5 — 구 호스트 정리 (삭제하지 않는다)"

	# 유실 규모를 숫자로 남긴다. "얼마 안 될 것" 이라고 넘기면 나중에 데이터가 비는 이유를 찾을 근거가 없다.
	if OLD_NOW="$(row_counts "$OLD_IP" "$DOCKER_OLD" 2> /dev/null)"; then
		printf '%s\n' "$OLD_NOW" > "$WORKDIR/rowcounts-old-final.txt"
		step "freeze 이후 구 호스트에만 쌓인 행 (= 유실분)"
		diff "$WORKDIR/rowcounts-old.txt" "$WORKDIR/rowcounts-old-final.txt" || true
	fi

	# 타이머를 **먼저** 끈다. 순서를 바꾸면 구 호스트가 계속 배포를 시도하고 오프사이트 버킷에 옛 데이터를
	# 최신 이름으로 올린다.
	#
	# 유닛 이름을 박아 두지 않고 **실제로 도는 것을 열거해서** 끈다. `install-pull-deploy.sh` 는 유닛을
	# 커밋해 두지 않고 생성하므로(§7-1) 이름이 문서와 어긋날 수 있고, 틀린 이름으로 `disable` 하면
	# systemctl 이 실패하는데 `|| true` 로 삼키면 **끈 줄 알고 넘어간다** — 이 스크립트를 쓰면서 실제로
	# 그랬다(실제 이름은 `rp-pull-deploy` 가 아니라 `reputation-pool-deploy` 였다). 그래서 끈 뒤에
	# 남은 것이 없는지 다시 확인한다.
	log "타이머 정지"
	list_our_timers() {
		on_host "$OLD_IP" 'systemctl list-units --type=timer --state=active --no-legend --plain' \
			| awk '{print $1}' | grep -E '^(reputation-pool|rp-)' || true
	}
	OLD_TIMERS="$(list_our_timers)"
	if [ -n "$OLD_TIMERS" ]; then
		printf '%s\n' "$OLD_TIMERS" | sed 's/^/  /'
		# 되돌릴 때 정확히 이것만 다시 켠다(--rollback 이 이 파일을 읽는다).
		printf '%s\n' "$OLD_TIMERS" > "$WORKDIR/old-timers.txt"
		# 원격 명령은 한 덩어리 문자열이므로 유닛 목록을 한 줄로 편다(로컬 word splitting 과 무관하다).
		UNITS_INLINE="$(printf '%s' "$OLD_TIMERS" | tr '\n' ' ')"
		on_host "$OLD_IP" "sudo systemctl disable --now $UNITS_INLINE" \
			|| die "타이머 정지 실패 — 구 호스트가 계속 배포·백업을 시도한다"
	else
		log "정지할 타이머가 없다"
	fi
	LEFT_TIMERS="$(list_our_timers)"
	[ -z "$LEFT_TIMERS" ] || die "아직 도는 타이머가 있다: $LEFT_TIMERS"

	# a1-hunter 는 타이머가 아니라 상시 서비스다(Restart=always). 없는 호스트도 있으므로 실패는 넘긴다 —
	# 이쪽은 버킷·배포를 건드리지 않아 남아 있어도 데이터를 오염시키지 않는다.
	on_host "$OLD_IP" 'sudo systemctl disable --now a1-hunter.service 2> /dev/null || true'

	log "컨테이너 정지 (볼륨·데이터는 보존)"
	on_host "$OLD_IP" "$DOCKER_OLD ps --filter name=reputation-pool- --format '{{.Names}}' | xargs -r $DOCKER_OLD stop" \
		> /dev/null || die "컨테이너 정지 실패"

	mark_done 5
fi

cat <<EOF

$(ts) ==> 이전 완료

  신규 오리진  $NEW_IP  ($NEW_ARCH)
  작업 디렉터리 $WORKDIR   (덤프·.env·DNS 스냅샷 — 지우지 않는다)

  확인:
    curl -fsS https://app.$ZONE/actuator/health
    ./scripts/cf-dns.sh --check $NEW_IP

  남은 수동 절차:
    · 신규 인스턴스가 **다른 서브넷**이면 오리진을 다시 잠근다:  ./scripts/oci-origin-lock.sh
      (같은 서브넷이면 규칙이 이미 적용돼 있어 할 일이 없다. --check 로 판정한다)
    · A1 사냥을 계속하려면 신규 호스트에서:  ./scripts/install-a1-hunter.sh

  되돌리기:  $0 --rollback $WORKDIR
  구 인스턴스 폐기(며칠 뒤):  $0 --decommission $WORKDIR
EOF
