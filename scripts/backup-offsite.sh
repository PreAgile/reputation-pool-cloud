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
#   OFFSITE_RETENTION_DAYS=30      # 원격 보존(서버 볼륨은 backup.sh 가 7일)
#   OFFSITE_VOLUME=               # 비우면 자동 탐색
#
# 실패하면 메일로 알린다(`notify-mail.py`). 백업의 진짜 실패 모드는 "안 도는 것" 이 아니라 "안 도는데
# 아무도 모르는 것" 이다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

export SUPPRESS_LABEL_WARNING=True
export OCI_CLI_AUTH="${OCI_CLI_AUTH:-instance_principal}"

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

# 실패는 반드시 사람에게 닿아야 한다. 메일 설정이 없으면 로그만 남는다(그 사실도 로그에 남긴다).
alert() {
	local subject="$1" body="$2" rc=0
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
# 원격 보존기간 정리
# ---------------------------------------------------------------------------
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
fi

log "완료"
