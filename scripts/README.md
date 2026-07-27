# 운영 스크립트 (#15)

- `oci-launch-retry.sh` — Oracle A1 인스턴스를 용량이 풀릴 때까지 재시도해 생성한다
  (`Out of host capacity` 대응). OCI CLI + API 키 인증이 필요하다.
- `bootstrap.sh` — 빈 리눅스 호스트를 스택이 도는 상태로 만든다(멱등, 재실행이 곧 재배포).
  작은 호스트면 오버레이를 인자로 넘긴다: `./scripts/bootstrap.sh compose.prod.6gb.yaml`.
  절차와 배경은 [`docs/engineering/deployment.md`](../docs/engineering/deployment.md).
- `harden-ssh.sh` — sshd 인증 정책을 확정하고 브루트포스 표면을 닫는다(키 전용 기본, fail2ban,
  무인 보안 업데이트). **서버에서** 실행한다. `SSH_PASSWORD_AUTH=1` 로 비밀번호 인증을 켤 수도 있지만
  기본은 끈다 — 22 번이 열려 있는 동안 비밀번호는 추측 가능한 자격이다.
- `oci-ssh-allow.sh` — 22 번 인그레스 허용 IP 를 관리한다(집·사무실·카페 이동 대응). **노트북에서**
  실행한다 — SSH 가 막힌 상태에서도 복구해야 하므로 OCI API 만 쓴다. 결과 목록에 자기 IP 가 없으면
  적용을 거부한다.
- `oci-origin-lock.sh` — 80/443 인그레스를 Cloudflare 공개 대역으로만 제한한다(§6 오리진 잠그기).
  Cloudflare 가 대역을 추가하면 재실행한다. `--unlock` 으로 되돌린다.
- `backup.sh` / `restore.sh` — 아래.
- `dev-seed.sql` — 로컬 개발용 시드.

## DB 백업 / 복원

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
- **복원 리허설을 실 서버에서 한 번 통과** — `RestoreRehearsalIT` 는 CI 에서 덤프/복원 경로만 검증한다
- 시크릿 스토어(#6) — 현재는 서버의 `.env` 파일
- 스테이징/프로덕션 분리, 자동 배포(CI → 서버). 배포 타깃은 확정됐다
  ([ADR 0002](../docs/decisions/0002-deploy-target-oracle-a1-arm64.md))
