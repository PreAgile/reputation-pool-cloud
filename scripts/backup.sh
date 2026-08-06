#!/bin/sh
# 일일 DB 백업 (#15). db 컨테이너를 pg_dump(custom format, -Fc)로 덤프해 /backups 볼륨에 타임스탬프
# 파일로 남기고, 보존 기간이 지난 덤프를 지운다. compose 의 backup 사이드카가 하루 한 번 호출한다.
# 복원은 restore.sh, 복원 가능성은 RestoreRehearsalIT 가 자동 검증한다("복원해본 적 없는 백업은 백업이
# 아니다" — #15 종료 기준).
set -eu

PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-reputation_pool}"
PGDATABASE="${PGDATABASE:-reputation_pool}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
# 신선도 textfile 을 쓸 디렉터리(#131). compose 가 reputation-pool-metrics 볼륨을 여기 마운트한다.
# 빈 값으로 주면 기록을 건너뛴다 — 이 스크립트는 로컬에서 볼륨 없이도 손으로 돌 수 있어야 한다.
#
# **`:-` 가 아니라 `-` 다.** `${VAR:-기본}` 은 변수가 **비어 있을 때도** 기본값을 쓰므로
# `BACKUP_METRICS_DIR=` 로 껐다고 믿는 사람에게 `/metrics` 를 되돌려주고, 아래 `[ -n … ]` 검사는 영원히
# 참이 되어 죽은 코드가 된다. `${VAR-기본}` 은 **미설정일 때만** 기본값을 쓰므로 빈 값이 그대로 남아
# 그 검사가 의미를 갖는다.
METRICS_DIR="${BACKUP_METRICS_DIR-/metrics}"
# PGPASSWORD 는 환경에서 주입(compose 가 REPUTATION_POOL_DB_PASSWORD 로 전달).

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR}/${PGDATABASE}_${ts}.dump"
# set -eu 로 pg_dump 실패 시 즉시 종료돼도 불완전한 .partial 이 남지 않게 한다(성공 후엔 mv 되어 no-op).
trap 'rm -f "${out}.partial"' EXIT

mkdir -p "$BACKUP_DIR"
# -Fc(custom): 압축 + pg_restore 로 선택 복원 가능. 원자적 쓰기: 임시 파일에 받은 뒤 rename.
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "${out}.partial"
mv "${out}.partial" "$out"
echo "backup written: $out ($(wc -c < "$out") bytes)"

# 보존: RETENTION_DAYS 보다 오래된 덤프 삭제.
find "$BACKUP_DIR" -name "${PGDATABASE}_*.dump" -type f -mtime "+${RETENTION_DAYS}" -delete
echo "pruned dumps older than ${RETENTION_DAYS} days"

# 신선도 게이지 (#131) — "며칠째 새 백업이 없다"를 관측 가능하게 만든다. 실패하면 이 줄에 닿지 않으므로
# 게이지가 낡고, 그것이 곧 알림 조건이다(alerts.yml 의 BackupStale).
#
# **쓰기가 실패해도 백업을 실패로 만들지 않는다.** 관측 실패가 백업 실패로 번지면 이 변경이 백업을 더
# 약하게 만든다 — 덤프는 이미 디스크에 있고, 게이지가 낡으면 알림이 그 사실을 대신 알린다.
#
# 원자적 쓰기: node-exporter 는 `*.prom` 만 읽으므로 `.tmp` 에 쓴 뒤 rename 한다. 그렇게 하지 않으면
# 쓰는 중간을 스크레이프해 잘린 파일을 파싱하게 된다(textfile collector 의 알려진 함정).
if [ -n "$METRICS_DIR" ] && [ -d "$METRICS_DIR" ]; then
	# `A && B || C` 를 쓰지 않는다 — 그것은 if-then-else 가 아니라서 B(성공 로그)가 실패하면 C(경고)까지
	# 실행돼 두 메시지가 함께 나온다(shellcheck SC2015).
	#
	# stderr 를 버리지 않는다. 실패하는 경우는 대개 권한·마운트 문제이고 셸이 그 이유를 stderr 에 적는데
	# (`… .prom.tmp: Permission denied`), 그것을 지우면 사이드카 로그에 "could not write" 만 남아 원인을
	# 다시 찾아야 한다. 리다이렉션 자체의 실패는 `2> /dev/null` 로도 억제되지 않으므로(셸이 보고한다)
	# 지우려는 시도가 실효도 없었다 — 실측으로 확인했다.
	if {
		printf '# HELP rp_backup_local_last_success_timestamp_seconds Unix time of the last successful local pg_dump.\n'
		printf '# TYPE rp_backup_local_last_success_timestamp_seconds gauge\n'
		printf 'rp_backup_local_last_success_timestamp_seconds %s\n' "$(date -u +%s)"
	} > "${METRICS_DIR}/rp-backup-local.prom.tmp" \
		&& mv "${METRICS_DIR}/rp-backup-local.prom.tmp" "${METRICS_DIR}/rp-backup-local.prom"; then
		echo "freshness gauge written: ${METRICS_DIR}/rp-backup-local.prom"
	else
		echo "warn: could not write freshness gauge to ${METRICS_DIR} (backup itself succeeded)"
	fi
else
	echo "freshness gauge skipped (metrics dir '${METRICS_DIR}' not mounted)"
fi
