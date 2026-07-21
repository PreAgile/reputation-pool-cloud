# DB 백업 / 복원 (#15)

로컬/셀프호스트에서 `docker compose up` 으로 서비스를 운영할 때의 데이터 안전 장치.

## 백업

`compose.yaml` 의 `backup` 사이드카가 `scripts/backup.sh` 를 **하루 한 번** 실행해 `db` 를
`pg_dump -Fc`(custom format, 압축)로 덤프하고 `reputation-pool-backups` 볼륨에 타임스탬프 파일로 남긴다.
`BACKUP_RETENTION_DAYS`(기본 7)보다 오래된 덤프는 자동 삭제한다.

```bash
# 지금 즉시 한 번 백업(주기 기다리지 않고)
docker compose exec backup /usr/local/bin/backup.sh

# 백업 목록
docker compose run --rm -v reputation-pool-backups:/backups backup ls -lh /backups
```

## 복원

`scripts/restore.sh <dump>` 가 custom-format 덤프를 대상 DB 로 복원한다(`--clean --if-exists`, 멱등).

```bash
docker compose run --rm backup \
  /usr/local/bin/restore.sh /backups/reputation_pool_YYYYMMDDT......Z.dump
```

> ⚠️ 복원은 대상 DB 의 객체를 드롭 후 재생성한다. 프로덕션 복원 전 대상을 반드시 확인할 것.

## 복원 리허설 (종료 기준)

"복원해본 적 없는 백업은 백업이 아니다." `RestoreRehearsalIT` 가 `seed → pg_dump(-Fc) → 빈 DB 로
pg_restore → 행 검증` 을 자동으로 돈다(Testcontainers). 스크립트가 쓰는 것과 **동일한 덤프/복원 경로**를
검증하므로, 포맷·도구가 라운드트립을 깨면 CI/`./gradlew integrationTest` 에서 잡힌다.

## 후속 (#15)

- 오프사이트 저장(오브젝트 스토리지 업로드) + RPO/RTO 확정
- 스테이징/프로덕션 compose 분리, 시크릿 관리, CI/CD — 배포 타깃 결정 후
