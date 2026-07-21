#!/bin/sh
# DB 복원 (#15). backup.sh 가 만든 custom-format(-Fc) 덤프를 대상 DB로 복원한다.
#   docker compose run --rm -v reputation-pool-backups:/backups backup \
#     /usr/local/bin/restore.sh /backups/reputation_pool_YYYYMMDDT...Z.dump
# --clean --if-exists: 기존 객체를 드롭 후 재생성(멱등). 프로덕션 복원 전 대상 DB 를 반드시 확인할 것.
set -eu

DUMP="${1:?usage: restore.sh <dump-file>}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-reputation_pool}"
PGDATABASE="${PGDATABASE:-reputation_pool}"
# PGPASSWORD 는 환경에서 주입.

[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }

echo "restoring $DUMP -> ${PGUSER}@${PGHOST}/${PGDATABASE}"
pg_restore -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" --clean --if-exists --no-owner "$DUMP"
echo "restore complete"
