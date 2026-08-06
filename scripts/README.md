# 운영 스크립트 (#15)

- `oci-launch-retry.sh` — Oracle A1 인스턴스를 용량이 풀릴 때까지 재시도해 생성한다
  (`Out of host capacity` 대응). OCI CLI + API 키 인증이 필요하다.
- `bootstrap.sh` — 빈 리눅스 호스트를 스택이 도는 상태로 만든다(멱등, 재실행이 곧 재배포).
  작은 호스트면 오버레이를 인자로 넘긴다: `./scripts/bootstrap.sh compose.prod.6gb.yaml`.
  절차와 배경은 [`docs/engineering/deployment.md`](../docs/engineering/deployment.md).
- `pull-deploy.sh` — **서버가 GitHub 에 물어봐서** 배포한다(풀 방식). `origin/main` 에 새 커밋이 있으면
  이미지 발행을 확인한 뒤 체크아웃·태그를 맞추고 `bootstrap.sh` 를 부르며, 헬스 확인이 실패하면 직전
  커밋·태그로 **자동 롤백**한다. 인바운드 SSH 가 필요 없어 22 번을 좁힌 채로 자동 배포가 된다 —
  Actions → SSH 를 쓰지 않는 이유는 [`deployment.md` §7-1](../docs/engineering/deployment.md) 참고.
  `.env` 의 `PULL_DEPLOY_ENABLED=true` 가 없으면 아무것도 하지 않는다(fail closed·킬 스위치).
- `install-pull-deploy.sh` — 위 스크립트를 주기 실행하는 systemd 서비스·타이머를 설치한다.
  **서버에서** 실행한다. 유닛을 커밋해 두지 않고 생성하는 이유는 `User=`·`WorkingDirectory=` 가
  호스트마다 달라서다 — 박아 두면 다른 호스트에서 조용히 틀린 디렉터리를 배포한다.
- `harden-ssh.sh` — sshd 인증 정책을 확정하고 브루트포스 표면을 닫는다(키 전용 기본, fail2ban,
  무인 보안 업데이트). **서버에서** 실행한다. `SSH_PASSWORD_AUTH=1` 로 비밀번호 인증을 켤 수도 있지만
  기본은 끈다 — 22 번이 열려 있는 동안 비밀번호는 추측 가능한 자격이다.
- `oci-ssh-allow.sh` — 22 번 인그레스 허용 IP 를 관리한다(집·사무실·카페 이동 대응). **노트북에서**
  실행한다 — SSH 가 막힌 상태에서도 복구해야 하므로 OCI API 만 쓴다. 결과 목록에 자기 IP 가 없으면
  적용을 거부한다.
- `oci-origin-lock.sh` — 80/443 인그레스를 Cloudflare 공개 대역으로만 제한한다(§6 오리진 잠그기).
  Cloudflare 가 대역을 추가하면 재실행한다. `--check` 는 드리프트만 판정하고(동기화 0 / 어긋남 3),
  `--unlock` 은 되돌린다.
- `origin-lock-check-cron.sh` + `com.poolroost.origin-lock-check.plist` — 위 `--check` 를 주 1회
  실행해 **드리프트가 있을 때만** 알린다. 대역이 추가되면 그 대역을 쓰는 엣지의 요청만 막혀
  "일부 지역 유저만 502" 가 되는데, 부분 장애라 모니터링에 잘 안 잡히고 원인이 몇 달 전 방화벽
  규칙이라는 걸 떠올리기 어렵다. **감지는 자동, 적용은 사람이** — 외부 URL 응답으로 방화벽을
  자동으로 다시 쓰는 것은 그 엔드포인트가 오염·부분응답일 때 스스로 구멍을 만든다.
  설치 방법과 macOS TCC 주의사항은 plist 상단 주석 참고.
- `cf-dns.sh` — Cloudflare 의 오리진 A 레코드를 조회·전환·복원한다(§11 호스트 이전의 DNS 부분).
  **노트북에서** 실행한다 — 서버가 침해돼도 DNS 는 건드릴 수 없어야 하므로 토큰을 서버에 두지 않는다
  (`oci-origin-lock.sh` 와 같은 이유). 전환 대상을 **이름이 아니라 "content 가 구 오리진 IP 인 A 레코드"**
  로 고르는 것이 핵심이다 — 이 zone 에는 Cloudflare Pages 를 가리키는 레코드(apex·`www`·`docs`·`status`)가
  섞여 있고 그쪽은 오리진이 죽어도 살아 있어야 한다. 이름 목록으로 골랐다면 목록 갱신을 잊는 순간
  랜딩까지 옮겨 죽인다. `--switch` 는 변경 전 스냅샷을 남기고 `--restore` 가 그것으로 되돌린다.
- `migrate-host.sh` — 호스트 이전 오케스트레이터(§11). 데이터·시크릿·**인증서**·DNS 를 한 번의 실행으로
  옮기고, 단계 마커를 남겨 재실행이 이어서 진행된다. **노트북에서** 실행한다.
  `--dry-run`(점검만) / `--rollback <작업디렉터리>`(DNS 되돌리고 구 호스트 재기동) /
  `--decommission <작업디렉터리>`(가드 3개를 통과해야 구 인스턴스 종료).
  개별 부품(`bootstrap.sh`·`restore.sh`·`cf-dns.sh`·`install-*`)을 부르므로 그 스크립트들이 하는 일을
  다시 구현하지 않는다 — 이 스크립트가 더하는 것은 **순서·전환 전 검증·되돌릴 근거**다.
- `backup.sh` / `restore.sh` — 아래.
- `backup-offsite.sh` 는 DB 덤프 외에 **`.env` 를 인증서로 암호화해** 같은 버킷의 `env/` 로 올린다.
  DB 만 올려 두면 인스턴스 소실 시 데이터는 있는데 열 열쇠가 없다. 개인키는 **호스트에 두지 않는다** —
  이 호스트는 자기가 올린 시크릿을 스스로 읽을 수 없다. 준비·복원 절차는
  [`deployment.md` §8-1](../docs/engineering/deployment.md).
  실패 알림 메일은 **systemd 로 돌 때만** 나간다(손 실행 실패까지 메일로 오면 알림을 믿지 않게 된다).
  systemd 밖의 자동화에서 부른다면 `OFFSITE_ALERT_MAIL=always` 로 알림을 살려 둔다.
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
