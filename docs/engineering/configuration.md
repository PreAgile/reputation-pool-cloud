# 설정과 시크릿 (#6)

`.env.example` 은 **각 변수가 무엇인지**를 그 자리에서 설명한다(주석이 곧 레퍼런스다). 이 문서는 그
위층을 다룬다 — **어디에 사는가 · 누가 읽는가 · 어떻게 바꾸는가 · 무엇을 얼마나 보관하는가.**

관련: [배포 절차](deployment.md) · [트러블슈팅](troubleshooting.md) · [보안 경계](security.md) ·
[백업/복원](../../scripts/README.md)

## 1. 설정이 사는 곳은 네 군데다

| 위치 | 무엇 | 누가 읽나 | git |
|---|---|---|---|
| `.env.example` | 변수 목록과 설명 | 사람 | ✅ 커밋 |
| 배포 호스트의 `<repo>/.env` | 실제 값 | compose, `bootstrap.sh`, `pull-deploy.sh` | ❌ gitignore |
| 배포 호스트의 `~/.rp-mail.env` | SMTP 자격증명 | `notify-mail.py` | ❌ (레포 밖) |
| 배포 호스트의 `~/.a1-hunter.env` | A1 사냥 설정 | systemd `EnvironmentFile` | ❌ (레포 밖) |

**다섯 번째가 없는 것이 중요하다: OCI API 키 파일.** 서버는 인스턴스 프린시펄로 인증하므로 클라우드
자격증명 파일이 디스크에 없다. 권한은 IAM 정책(dynamic group `a1-hunter`, `rp-prod-host`)에만 있고,
문제가 생기면 정책을 지워 즉시 차단된다. 파일이 없으면 유출될 파일도 없다.

`.env` 는 `git reset --hard` 로도 지워지지 않는다(gitignore 대상이라 untracked). 그래서 자동 배포가
체크아웃을 갈아치워도 호스트 설정은 남는다. 반대로 **새 키가 생긴 릴리스는 자동으로 채워지지 않는다** —
[deployment.md §「새 `.env` 키가 생긴 릴리스로 재배포할 때」](deployment.md) 참고.

### 파일 권한

```bash
chmod 600 ~/.rp-mail.env ~/.a1-hunter.env   # 설치 스크립트가 umask 077 로 만든다
ls -l <repo>/.env                            # 최소 600
```

## 2. 시크릿 목록과 회전

여기서 "회전"은 **값을 바꾸는 절차**를 말한다. 지금 스택에서 무중단으로 도는 것과 재시작이 필요한 것이
갈린다.

| 시크릿 | 쓰는 곳 | 회전 | 무중단 |
|---|---|---|---|
| `REPUTATION_POOL_API_KEY` | gRPC `x-api-key` 부트스트랩 키 | 아래 §2-1 | ❌ (재시작) |
| 대시보드에서 발급한 API 키 | gRPC 데이터플레인 | 콘솔에서 발급 → 클라이언트 교체 → 구 키 폐기 | ✅ |
| `REPUTATION_POOL_DB_PASSWORD` | app ↔ db | §2-2 | ❌ |
| `REPUTATION_POOL_ADMIN_PASSWORD` · `_JWT_SECRET` | 관리 콘솔 로그인/토큰 | `.env` 수정 후 재기동 | ❌ (기존 토큰 즉시 무효) |
| `GRAFANA_ADMIN_PASSWORD` | Grafana | `.env` 수정 후 grafana 재기동 | ❌ |
| `REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL` | 알림 라우팅 | `.env` 수정 후 alertmanager 재기동 | ❌ |
| `SMTP_PASS` (`~/.rp-mail.env`) | 메일 알림 | OCI 콘솔에서 새 SMTP 자격증명 발급 → 파일 교체 → 구 자격증명 삭제 | ✅ (다음 발송부터) |

### 2-1. gRPC 부트스트랩 키

`REPUTATION_POOL_API_KEY` 는 `ApiKeySeeder` 가 기동 시 심는 **초기 키**다. 운영 중 발급하는 키는
대시보드(`/keys`)에서 만들고 `ApiKeyManagementService` 가 해시로 저장한다(`ApiKeyHashing`).

```bash
# 1) 새 값 준비
openssl rand -base64 32

# 2) .env 교체 후 재배포 (bootstrap.sh 는 멱등 — 재실행이 곧 재배포다)
sed -i 's|^REPUTATION_POOL_API_KEY=.*|REPUTATION_POOL_API_KEY=<새값>|' .env
./scripts/bootstrap.sh
```

⚠️ **무중단 회전(grace window)은 아직 없다** — #32. 지금은 교체 순간 구 키를 쓰던 클라이언트가 끊긴다.
운영 중인 클라이언트가 있으면 **부트스트랩 키 대신 콘솔 발급 키를 쓰고**, 새 키 발급 → 클라이언트 교체 →
구 키 폐기 순서로 돌린다(그 경로는 무중단이다).

### 2-2. DB 비밀번호

app 과 db 컨테이너가 같은 변수를 읽으므로 **한쪽만 바꾸면 붙지 못한다.** 기존 데이터가 있는 볼륨에서는
Postgres 가 이미 만들어진 롤의 비밀번호를 환경변수로 갱신하지 않는다는 점도 함께 걸린다.

```bash
# 1) 실행 중인 db 에서 롤 비밀번호를 먼저 바꾼다
docker compose exec db psql -U reputation_pool -c "ALTER USER reputation_pool PASSWORD '<새값>';"

# 2) .env 를 같은 값으로 맞추고 재배포
sed -i 's|^REPUTATION_POOL_DB_PASSWORD=.*|REPUTATION_POOL_DB_PASSWORD=<새값>|' .env
./scripts/bootstrap.sh
```

순서를 뒤집으면 app 이 옛 비밀번호로 붙으려다 실패한다.

### 2-3. 유출됐다고 판단되면

1. **먼저 끊는다** — 해당 키를 콘솔에서 폐기(`/keys`), 관리자 자격이면 `.env` 에서 값을 비우고 재기동
   (미설정 시 `/api/**` 는 fail closed 로 전부 거부된다)
2. `audit` 트레일에서 그 키의 사용 이력을 본다 (테넌트 스코프 — #82 이후 토큰 테넌트로 강제된다)
3. OCI 자격증명이면 IAM 정책·dynamic group 을 지우는 것이 가장 빠른 차단이다

## 3. 보존 기간

세 가지가 서로 다른 곳에서 정해진다.

### 감사 트레일

```
REPUTATION_POOL_AUDIT_RETENTION=P0D     # 기본: 영구 보관 (P0D = 끄기). 유일한 감사 보존 노브다
```

**기본이 "영원히 안 지움"인 것은 의도**다(`ReputationPoolProperties.Audit`). 감사 로그를 조용히 지우는
쪽이 더 위험하므로 켜는 것을 명시적 선택으로 뒀다. ISO-8601 기간으로 준다(`P30D`, `P1Y`). 0 이하면
퍼지 작업 자체가 돌지 않는다.

퍼지 주기(`reputation-pool.audit.purge-interval`)는 `application.yml` 에 `PT1H` 로 고정돼 있고 환경변수로
빼두지 않았다 — 보존 기간을 정하면 주기는 따라오는 값이라 노브를 늘릴 이유가 없었다. 바꾸려면 코드 변경이
필요하다.

같은 파일의 다른 운영 노브도 함께 알아둘 것: `REPUTATION_POOL_MAX_RESOURCES`(기본 100,000) ·
`REPUTATION_POOL_MAX_CELLS`(기본 500,000)는 **테넌트별이 아니라 전체 합계** 상한이다(#84 — 공유 JVM
이므로 혼자면 전부 쓰고 여럿이면 동적으로 나눈다). 둘 다 실측 없는 가설값이다.

### 백업

| 어디 | 보존 | 정하는 곳 |
|---|---|---|
| 서버 볼륨 | 7일 | `BACKUP_RETENTION_DAYS` (`backup.sh`) |
| Object Storage | 30일 | `OFFSITE_RETENTION_DAYS` (`backup-offsite.sh`, `~/.rp-backup.env`) |

원격을 더 길게 두는 이유는 오프사이트의 목적이 "서버가 사라진 뒤"이기 때문이다. 서버 볼륨의 7일은
사고 직후 되돌리기용이고, 30일은 서버 자체가 없어진 상황용이다.

`OFFSITE_RETENTION_DAYS` 는 **정수여야 한다** — 아니면 시작 시점에 죽는다. 그러지 않으면 비교식이 거짓이
되어 정리 단계가 통째로 조용히 스킵된다(그 상태로도 업로드는 계속돼 겉보기엔 정상이다).

### 테넌트 데이터

테넌트를 `deleted` 로 내리면 연관 데이터가 캐스케이드 삭제된다(#83, `active`/`suspended`/`deleted`
라이프사이클). 이건 기간이 아니라 상태 전이로 동작한다.

## 4. 설정을 바꾸는 세 가지 경로

| 무엇을 바꾸나 | 어떻게 | 반영 시점 |
|---|---|---|
| 런타임 값(`.env`) | 호스트에서 수정 → `./scripts/bootstrap.sh` | 즉시(재기동) |
| 알림 임계값·룰(`monitoring/*`) | 레포에 커밋 → main 머지 | 5분 내 자동 배포 |
| 이미지에 굽히는 값(`NEXT_PUBLIC_*`) | GitHub 저장소 변수 → 재빌드 | 다음 릴리스 |

**세 번째를 호스트 `.env` 에 넣으면 아무 일도 일어나지 않는다.** `NEXT_PUBLIC_SITE_URL` 은 Next 가
정적 프리렌더 시점에 인라인하는 빌드타임 변수라 `release.yml` 이 `docker build --build-arg` 로 넘긴다.
값이 틀리면 canonical/hreflang/OG 가 전부 잘못된 호스트를 가리켜 **조용히 색인이 안 된다**(실제로
DNS 조차 없는 도메인이 기본값이던 시기가 있었다).

`monitoring/*` 이 두 번째 경로인 이유: 알림 룰과 compose 파일은 이미지 안이 아니라 **서버 체크아웃에서
bind-mount** 된다. 그래서 `pull-deploy.sh` 가 이미지만 갱신하지 않고 `git reset --hard` 로 체크아웃을
맞춘다.

## 5. 절대 하지 않는 것

- **`.env` 를 커밋하지 않는다.** `bootstrap.sh` 는 `.env.example` 의 placeholder 값이 그대로 남아 있으면
  기동을 거부한다(로컬 개발 값이 공개 서버로 넘어오는 사고 방지)
- **`.env` 를 셸로 `source` 하지 않는다.** 값에 `[`·`$` 가 섞이면 셸이 해석해 조용히 잘린다. 스크립트들은
  전부 직접 파싱한다(`pull-deploy.sh` 의 `env_value`, `notify-mail.py` 의 `load_config`)
- **프로덕션에서 `docker compose down -v` 를 쓰지 않는다.** `caddy-data` 의 인증서가 사라져 재발급이
  일어나고 Let's Encrypt 레이트리밋을 소모한다. DB 볼륨도 함께 지워진다
- **Grafana·관리 엔드포인트를 공개 도메인에 붙이지 않는다.** Grafana 는 `127.0.0.1:3001` loopback 이고
  SSH 터널로만 접근한다
