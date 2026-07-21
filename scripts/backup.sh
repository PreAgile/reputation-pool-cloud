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
# PGPASSWORD 는 환경에서 주입(compose 가 REPUTATION_POOL_DB_PASSWORD 로 전달).

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR}/${PGDATABASE}_${ts}.dump"

mkdir -p "$BACKUP_DIR"
# -Fc(custom): 압축 + pg_restore 로 선택 복원 가능. 원자적 쓰기: 임시 파일에 받은 뒤 rename.
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "${out}.partial"
mv "${out}.partial" "$out"
echo "backup written: $out ($(wc -c < "$out") bytes)"

# 보존: RETENTION_DAYS 보다 오래된 덤프 삭제.
find "$BACKUP_DIR" -name "${PGDATABASE}_*.dump" -type f -mtime "+${RETENTION_DAYS}" -delete
echo "pruned dumps older than ${RETENTION_DAYS} days"
