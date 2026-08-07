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
chmod 600 ~/.rp-mail.env ~/.a1-hunter.env ~/reputation-pool-cloud/.env
ls -l ~/.rp-mail.env ~/.a1-hunter.env ~/reputation-pool-cloud/.env
```

설치 스크립트는 자기가 만드는 파일을 `umask 077` 로 두지만, `.env` 는 `cp .env.example .env` 로 사람이
만들기 때문에 기본 umask 를 따른다 — 위 명령으로 맞춘다.

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

### 2-0. 값을 명령행에 두지 않는다

아래 절차들이 `sed -i 's|...|<새값>|'` 대신 프롬프트를 쓰는 이유다:

- **셸 히스토리에 남는다** — `~/.bash_history` 는 평문이고, 시크릿을 지운 뒤에도 히스토리에는 남는다
- **`ps` 에 보인다** — 명령행 인자는 같은 호스트의 다른 사용자에게 그대로 노출된다
- **특수문자가 치환을 깬다** — `|`·`&`·`\` 가 들어간 값은 `sed` 치환식에서 다르게 해석된다.
  실제로 이 프로젝트에서 SMTP 비밀번호의 `[` 가 셸에 먹혀 인증 실패로만 보인 적이 있다

`read -rs` 는 입력을 에코하지 않고 히스토리에도 남기지 않는다. 값을 자식 프로세스로 넘길 때는
**환경변수**를 쓴다 — `/proc/<pid>/environ` 은 프로세스 소유자만 읽을 수 있어 명령행 인자보다 낫다.
쓰고 나면 `unset` 한다.

### 2-1. gRPC 부트스트랩 키

`REPUTATION_POOL_API_KEY` 는 `ApiKeySeeder` 가 기동 시 심는 **초기 키**다. 운영 중 발급하는 키는
대시보드(`/keys`)에서 만들고 `ApiKeyManagementService` 가 해시로 저장한다(`ApiKeyHashing`).

```bash
# 1) 값을 프롬프트로 받는다 — 셸 히스토리에도 ps 에도 남기지 않는다 (§2-0)
read -rsp '새 API 키: ' NEWVAL; echo

# 2) .env 교체 후 재배포 (bootstrap.sh 는 멱등 — 재실행이 곧 재배포다)
NEWVAL="$NEWVAL" RP_KEY=REPUTATION_POOL_API_KEY python3 - <<'PY'
import os, pathlib
key, val = os.environ["RP_KEY"], os.environ["NEWVAL"]
p = pathlib.Path(".env")
lines = p.read_text().splitlines()
out, seen = [], False
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={val}"); seen = True
    else:
        out.append(line)
if not seen:
    out.append(f"{key}={val}")
p.write_text("\n".join(out) + "\n")
print(f"{key} 갱신 완료 ({len(val)}자)")
PY
unset NEWVAL
./scripts/bootstrap.sh
```

⚠️ **무중단 회전(grace window)은 아직 없다** — #32. 지금은 교체 순간 구 키를 쓰던 클라이언트가 끊긴다.
운영 중인 클라이언트가 있으면 **부트스트랩 키 대신 콘솔 발급 키를 쓰고**, 새 키 발급 → 클라이언트 교체 →
구 키 폐기 순서로 돌린다(그 경로는 무중단이다).

### 2-2. DB 비밀번호

app 과 db 컨테이너가 같은 변수를 읽으므로 **한쪽만 바꾸면 붙지 못한다.** 기존 데이터가 있는 볼륨에서는
Postgres 가 이미 만들어진 롤의 비밀번호를 환경변수로 갱신하지 않는다는 점도 함께 걸린다.

```bash
# 1) 실행 중인 db 에서 롤 비밀번호를 먼저 바꾼다.
#    psql 의 \password 는 값을 프롬프트로 받아 서버로 보낸다 — SQL 문에도, 히스토리에도 남지 않는다.
docker compose exec db psql -U reputation_pool
# psql 안에서:
#   \password reputation_pool
#   \q

# 2) .env 를 같은 값으로 맞추고 재배포 (§2-1 과 같은 방식, 키 이름만 다르다)
read -rsp '같은 비밀번호를 다시: ' NEWVAL; echo
NEWVAL="$NEWVAL" RP_KEY=REPUTATION_POOL_DB_PASSWORD python3 - <<'PY'
import os, pathlib
key, val = os.environ["RP_KEY"], os.environ["NEWVAL"]
p = pathlib.Path(".env")
out, seen = [], False
for line in p.read_text().splitlines():
    if line.startswith(key + "="):
        out.append(f"{key}={val}"); seen = True
    else:
        out.append(line)
if not seen:
    out.append(f"{key}={val}")
p.write_text("\n".join(out) + "\n")
print(f"{key} 갱신 완료 ({len(val)}자)")
PY
unset NEWVAL
./scripts/bootstrap.sh
```

순서를 뒤집으면 app 이 옛 비밀번호로 붙으려다 실패한다. 두 값이 어긋나면 app 이 `FATAL: password
authentication failed` 로 기동하지 못하므로, `\password` 에 넣은 값과 `.env` 에 넣는 값이 같아야 한다.

### 2-3. 유출됐다고 판단되면

1. **먼저 끊는다** — 해당 키를 콘솔에서 폐기(`/keys`), 관리자 자격이면 `.env` 에서 값을 비우고 재기동
   (미설정 시 `/api/**` 는 fail closed 로 전부 거부된다)
2. `audit` 트레일에서 그 키의 사용 이력을 본다 (테넌트 스코프 — #82 이후 토큰 테넌트로 강제된다)
3. OCI 자격증명이면 IAM 정책·dynamic group 을 지우는 것이 가장 빠른 차단이다

## 3. 보존 기간

세 가지가 서로 다른 곳에서 정해진다.

### 감사 트레일

```dotenv
REPUTATION_POOL_AUDIT_RETENTION=P0D     # 기본: 영구 보관 (P0D = 끄기). 유일한 감사 보존 노브다
```

**기본이 "영원히 안 지움"인 것은 의도**다(`ReputationPoolProperties.Audit`). 감사 로그를 조용히 지우는
쪽이 더 위험하므로 켜는 것을 명시적 선택으로 뒀다. ISO-8601 기간으로 준다(`P30D`, `P1Y`). 0 이하면
퍼지 작업 자체가 돌지 않는다.

퍼지 주기(`reputation-pool.audit.purge-interval`)는 `application.yml` 에 `PT1H` 로 고정돼 있고 환경변수로
빼두지 않았다 — 보존 기간을 정하면 주기는 따라오는 값이라 노브를 늘릴 이유가 없었다. 바꾸려면 코드 변경이
필요하다.

### 데이터 플레인 요청 상한 (#132)

```dotenv
REPUTATION_POOL_RATE_LIMIT_ENABLED=true              # false 면 무제한 (사고 시 탈출구 — 아래 스트림 상한도 같이 꺼진다)
REPUTATION_POOL_RATE_LIMIT_REQUESTS_PER_SECOND=10    # 테넌트당 지속 요청율
REPUTATION_POOL_RATE_LIMIT_BURST=50                  # 몰아 보낼 수 있는 양(버킷 용량)
REPUTATION_POOL_RATE_LIMIT_MAX_CONCURRENT_STREAMS=20 # 테넌트당 동시 SubscribeEvents 스트림 수(#132 후속)
```

**테넌트별**이다 — `MAX_RESOURCES`/`MAX_CELLS`(전체 합계)와 다르다. 그쪽은 메모리 축을 막고 이쪽은
요청율을 막는다. 공유 JVM 이라 둘 다 필요하다.

기본값은 **실측 없는 가설**이고 넉넉하게 잡았다. 상한이 너무 낮으면 정상 고객을 막는데, 그 상태는 우리
눈에 "방어가 잘 되네" 로 보이고 고객 쪽에서는 제품이 고장난 것으로 보인다. #137(도그푸딩)이 실측을
만든 뒤 조인다.

⚠️ **단일 인스턴스 전제다.** 버킷이 JVM 힙에 있으므로 앱 인스턴스를 늘리면 각자 버킷을 가져 **실효
상한이 인스턴스 수만큼 곱해진다.** 제한기가 죽는 게 아니라 조용히 느슨해진다 — 멀티인스턴스로 갈 때
#85 와 함께 다시 설계한다.

거부는 `datapane.rate.limited` 카운터로 세고 알림 룰이 붙어 있다. `datapane.rate.limiter.errors` 가
0 이 아니면 **상한이 적용되지 않는 상태**다(제한기가 예외로 통과시키는 중).

`MAX_CONCURRENT_STREAMS` 는 다른 축이다. 위 두 값은 호출 빈도(토큰 버킷)를 재는데, `SubscribeEvents`
는 한 번 열면 클라이언트가 끊을 때까지 살아 있는 스트림이라 "호출 1회" 로는 안 잡힌다 — 토큰 하나로
스트림을 영원히 붙잡을 수 있다. 그래서 **동시에 열려 있는 구독 수**를 별도로 센다. 거부는
`datapane.stream.subscriptions.rejected` 로, 상한 자체가 죽는 상태는 `datapane.stream.quota.errors`
로 잡는다 — 두 실패 모두 요청율 상한과 똑같이 `RESOURCE_EXHAUSTED` 로 나가므로, 응답만 보고는 "요청이
많은 것"과 "스트림이 많이 열린 것"을 구분할 수 없다. 아래 [트러블슈팅](troubleshooting.md)의 분기를
참고할 것.

같은 파일의 다른 운영 노브도 함께 알아둘 것: `REPUTATION_POOL_MAX_RESOURCES`(기본 100,000) ·
`REPUTATION_POOL_MAX_CELLS`(기본 500,000)는 **테넌트별이 아니라 전체 합계** 상한이다(#84 — 공유 JVM
이므로 혼자면 전부 쓰고 여럿이면 동적으로 나눈다). 둘 다 실측 없는 가설값이다.

### 엔진 정책 — 인스턴스 기본값과 테넌트별 덮어쓰기 (#179)

`reputation-pool.engine.*` 과 `reputation-pool.lease-ttl` 은 이제 **이 인스턴스의 기본값**이다. 테넌트가
자기 정책을 저장하지 않았으면 그대로 이 값으로 돈다 — **정책 행이 하나도 없으면 #179 이전과 동작이
완전히 같다.** 노브는 여섯 개이고, 그중 둘(`cooldown-max-exponent`·`exploration-floor`)은 예전에
upstream 의 no-arg 생성자로 박혀 있어 운영자도 바꿀 수 없던 값이다. 기본값은 upstream 기본값 그대로다.

테넌트별 정책은 컨트롤 플레인에서 넣는다. 토큰이 바인딩된 테넌트만 다룰 수 있다(#82).

```
GET    /api/tenants/{id}/engine-policy          # 유효 정책 + 이 인스턴스의 상한 (프리필용)
PUT    /api/tenants/{id}/engine-policy          # 전 필드를 한 번에 (부분 덮어쓰기 없음)
GET    /api/tenants/{id}/engine-policy/history  # 누가·언제·무엇으로 바꿨는지
```

**저장은 다음 풀 생성부터 적용된다.** `ResourcePool` 의 엔진과 lease TTL 이 `final` 이라 도는 풀을 다시
튜닝할 수 없고, 바꿀 때마다 풀을 다시 지으면 그 테넌트의 평판 상태와 진행 중인 리스가 날아간다. 즉시
반영이 필요하면 운영자가 명시적으로 재시작한다.

`REPUTATION_POOL_POLICY_CEILING_MAX_MULTIPLE`(기본 10)이 테넌트 정책의 상한이다 — **위 기본값의 몇
배까지 허용하는가.** `window-size` 는 셀 하나가 들고 있는 결과 개수라 셀 단위로 세는 `MAX_CELLS` 가
보지 못하는 배수이고, 그 구멍을 막는 값이다. 상한은 정책을 저장할 때 걸어 400 으로 거절한다(풀 생성
시점이면 이미 늦다). 전역 예산을 테넌트 수로 나누지 않는 이유는 `GlobalResourceBudget` 의 무분할 원칙과
같다 — 혼자인 테넌트를 천장 아래로 묶게 되고, 테넌트가 들락날락할 때마다 재계산해야 한다. 이 배수도
실측 없는 가설값이다.

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

**세 번째를 호스트 `.env` 에 넣으면 아무 일도 일어나지 않는다.** `NEXT_PUBLIC_LANDING_URL` 은 Next 가
빌드 시점에 인라인하는 빌드타임 변수라 `release.yml` 이 `docker build --build-arg` 로 넘긴다.
리다이렉트 규칙도 `next build` 가 라우트 매니페스트로 구워내므로 런타임 환경변수로는 `Location` 조차
바꿀 수 없다. 값이 틀리면 옛 랜딩 URL 이 **존재하지 않는 호스트로 301** 되는데, 이건 404 보다 나쁘다 —
크롤러가 링크 지분을 죽은 주소로 옮긴다.

(계층 분리 전에는 이 자리가 `NEXT_PUBLIC_SITE_URL`, 즉 "이 앱 자신의 오리진"이었다. 랜딩·문서가
apex 로 나가면서 대시보드에는 canonical·hreflang·sitemap 이 하나도 남지 않았고 그 변수를 읽는 코드도
사라졌다 — #15. 랜딩 앱이 여전히 쓰는 동명 변수는 Cloudflare Pages 의 빌드 환경변수라 별개다.)

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
