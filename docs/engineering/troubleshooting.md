# 트러블슈팅 (#6)

**여기 있는 항목은 전부 이 프로젝트에서 실제로 겪은 것들이다.** 가상의 장애 목록이 아니라, 원인을 찾는 데
시간을 쓴 것만 증상 기준으로 모았다. 각 항목 끝에 근거(PR·이슈)를 달았다.

증상이 목록에 없으면 §0 부터 훑는다.

관련: [배포](deployment.md) · [설정·시크릿](configuration.md) · [SLO](slo.md) · [백업/복원](../../scripts/README.md)

## 0. 어디부터 보나

```bash
# 스택
docker compose -f compose.yaml -f compose.prod.yaml ps
docker compose -f compose.yaml -f compose.prod.yaml logs --tail 100 app

# 자동 배포 (5분 주기)
journalctl -u reputation-pool-deploy.service -n 50 --no-pager
cat ~/reputation-pool-cloud/.pull-deploy-state        # 마지막으로 성공한 커밋

# 오프사이트 백업 / A1 사냥
journalctl -u rp-backup-offsite.service -n 30 --no-pager
journalctl -u a1-hunter.service -n 20 --no-pager

# 바깥에서 본 모습
curl -sS -o /dev/null -w '%{http_code}\n' https://app.poolroost.com/actuator/health
curl -sS -o /dev/null -w '%{http_code}\n' https://app.poolroost.com/login
```

이 스택의 실패는 대체로 **"죽었다"가 아니라 "조용히 틀렸다"** 쪽이다. 로그가 성공이라고 말하는데 결과가
다른 경우를 우선 의심한다.

---

## 배포

### 배포가 됐다는데 옛 버전이 돈다

세 가지가 각각 이 증상을 만든다.

```bash
cat .pull-deploy-state                        # 배포 성공 표식
git -C ~/reputation-pool-cloud log --oneline -1   # 체크아웃
grep -E '^(APP|DASHBOARD)_IMAGE_TAG=' .env    # 이미지 태그
docker compose ps --format '{{.Service}} {{.Image}}'   # 실제 실행 이미지
```

**넷이 전부 같은 커밋이어야 한다.** 어긋나는 조합별 원인:

| 어긋난 곳 | 원인 |
|---|---|
| 체크아웃은 새 커밋인데 이미지가 옛것 | `git reset --hard` 뒤 `bootstrap.sh` 전에 죽었다. 표식이 이전 커밋에 남아 다음 주기가 다시 배포한다 |
| `.env` 태그는 새것인데 실행 이미지가 `latest` | `sudo docker compose` 가 `env_reset` 으로 export 한 변수를 버렸다 — 그래서 태그를 환경변수가 아니라 `.env` 파일에 쓴다 |
| 전부 옛것인데 로그는 "최신이다" | 아래 항목 |

근거: PR #116

### 타이머는 도는데 배포가 안 된다 ("최신이다"만 반복)

`pull-deploy.sh` 는 세 관문에서 멈출 수 있고 **각각 로그에 이유를 남긴다.**

```bash
journalctl -u reputation-pool-deploy.service --since -30min -o short-iso | grep -E 'CI|이미지|배포'
```

- `CI 가 아직 돌고 있다` — 정상. 다음 주기에 다시 본다
- `CI 실패한 커밋이라 배포하지 않는다` — `main` 에 브랜치 보호가 없어 테스트가 빨간 커밋도 이미지가
  발행된다. 이 게이트가 그걸 막는 것이므로 **고칠 것은 배포가 아니라 CI** 다
- `이미지가 아직 없다` — `release.yml` 이 도는 중. 몇 분 뒤 자동 해결
- `CI 상태를 확인할 수 없다` — GitHub API 에 못 닿았다. fail closed 라 배포하지 않는다
- `PULL_DEPLOY_ENABLED 가 true 가 아니다` — 킬 스위치가 켜져 있다

근거: PR #116

### 롤백했는데 5분 뒤 되돌아온다

자동 배포가 켜진 호스트에서 태그만 되돌리면 **다음 폴링이 `origin/main` 을 다시 올린다.** 순서가 있다:

```bash
sed -i 's|^PULL_DEPLOY_ENABLED=.*|PULL_DEPLOY_ENABLED=false|' .env   # ← 먼저
git reset --hard <되돌릴-sha>
sed -i 's|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=sha-<7자리>|' .env
sed -i 's|^DASHBOARD_IMAGE_TAG=.*|DASHBOARD_IMAGE_TAG=sha-<7자리>|' .env
./scripts/bootstrap.sh
```

`APP_IMAGE_TAG` 만 바꾸면 **대시보드는 새 이미지로 남는다**(별개 컨테이너다).

되돌릴 것이 코드 자체라면 `main` 에 revert 를 머지하는 편이 낫다 — 킬 스위치를 되돌려 놓는 것을 잊으면
이후 머지가 전부 배포되지 않고 로그에는 "아무것도 하지 않는다"만 남는다. `bootstrap.sh` 는 완료 안내에서
이 호스트의 자동 배포 상태를 확인해 맞는 절차를 출력한다.

근거: PR #117

### `bootstrap.sh` 가 사전 검사에서 즉사한다

`set -euo pipefail` 아래에서 `var=$(grep ... | head -1)` 은 **grep 이 아무것도 못 찾으면 스크립트 전체를
죽인다.** `DEPLOY_OVERLAYS` 가 없는 정상 호스트에서 그 회귀가 났다. 지금은 CI 의 `DRY_RUN` 게이트가 사전
검사 구간을 실제로 실행해 막는다. 같은 패턴을 새로 쓸 때 주의한다.

근거: PR #104

### HTTPS 가 평문으로 내려앉았다

TLS 호스트에서 인자 없이 `./scripts/bootstrap.sh` 를 재실행하면 오버레이가 빠져 Caddy 가 `:80` 으로
교체된다. 다운그레이드 가드가 막지만, 애초에 `.env` 에 모드를 고정한다:

```bash
DEPLOY_OVERLAYS=compose.prod.tls.yaml
```

의도적으로 내리려면 `ALLOW_PLAINTEXT_DOWNGRADE=1`.

### 인증서 발급이 실패한다

방화벽이 **2중**이다. `bootstrap.sh` 는 호스트 방화벽만 열 수 있고 **OCI 콘솔의 VCN Security List 는
못 건드린다.** 80/443 TCP + 443 UDP 가 거기서도 열려 있어야 한다. 증상이 "인증서 발급 실패"로 나타나
원인을 찾기 어렵다.

```bash
docker compose -f compose.yaml -f compose.prod.yaml -f compose.prod.tls.yaml logs caddy | tail -30
```

### 대시보드가 502 인데 배포는 성공으로 끝났다

`/actuator/health` 는 **app 이** 응답한다. 대시보드 컨테이너가 못 떠서 Caddy 가 502 를 내도 그 확인은
통과한다. 그래서 헬스 URL 을 목록으로 받는다:

```dotenv
PULL_DEPLOY_HEALTH_URLS="https://app.poolroost.com/actuator/health https://app.poolroost.com/login"
```

**목록의 URL 은 리다이렉트가 아니어야 한다** — `curl -fsS` 는 리다이렉트를 따라가지 않으므로 307 을 주는
경로를 넣으면 매 배포가 헬스 실패로 판정돼 롤백 루프에 빠진다.

근거: PR #116

---

## 모니터링·알림

### 알림 룰이 파싱은 되는데 영원히 안 울린다

가장 잡기 어려운 부류다. 룰은 문법상 올바르고 Prometheus 도 불평하지 않는데, 쿼리가 **빈 벡터**를
반환해 조건이 성립할 수 없다.

원인이 됐던 것들:

- **히스토그램 버킷이 없다** — `histogram_quantile()` 이 읽을 `..._bucket` 시계열 자체가 없었다.
  `management.metrics.distribution.percentiles-histogram` 으로 해당 타이머만 켠다
- **`le="0.5"` 경계가 없다** — SLI 가 "500ms 안에 끝난 비율"을 재려면 0.5 가 **실제 버킷 경계**여야
  한다. 기본 66개 버킷의 이웃은 0.447392 와 0.536871 이다. `distribution.slo` 로 경계를 추가한다
- **메트릭 이름이 바뀌었다** — 룰은 그대로인데 계측이 사라진 경우

확인:

```bash
# 시계열이 실제로 있는지
curl -s localhost:8083/actuator/prometheus | grep -c 'grpc_server_processing_duration_seconds_bucket'
curl -s localhost:8083/actuator/prometheus | grep 'le="0.5"' | head -3

# 룰 자체 검증 (CI 가 매번 돌린다)
docker run --rm -v "$PWD/monitoring:/w:ro" -w /w --entrypoint promtool prom/prometheus:v3.1.0 \
  test rules alerts-test.yml
```

`promtool check rules` 는 문법만 본다. **`test rules` 가 시계열을 주입해 발화까지 확인**하므로 새 룰은
반드시 `alerts-test.yml` 에 케이스를 추가한다.

근거: PR #96, #114

### 알림이 뜨는데 통지가 안 온다

`REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL` 이 비어 있으면 기본 리시버가 **no-op 블랙홀**이다 —
Alertmanager 는 그룹핑·중복제거까지 정상 수행하고 아무 데도 보내지 않는다. 값을 넣고
`monitoring/alertmanager.yml` 의 `webhook_configs` 블록 주석을 푼다.

### `docker compose up` 이 secret 관련 에러로 아예 안 뜬다

```text
environment variable "REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL" required by secret ... is not set
```

compose 의 `secrets: environment:` 소스는 **미정의 변수에서 하드 실패**한다(빈 값은 괜찮다).
`docker compose config` 는 통과하므로 `up` 에서만 드러난다. `.env` 에 **빈 값이라도 정의**한다.

---

## 인증·접근

### `/api/**` 가 전부 401/403 이다

관리 콘솔 자격 3종(`REPUTATION_POOL_ADMIN_USERNAME`·`_PASSWORD`·`_JWT_SECRET`)이 **하나라도** 없으면
콘솔이 fail closed 로 꺼진다. 토큰을 발급할 수 없으니 모든 `/api/**` 가 거부된다. gRPC 데이터플레인은
영향받지 않는다.

JWT 시크릿은 **32바이트 이상**이어야 한다(HS256).

### 로그인이 계속 막힌다

`LoginThrottle` 이 무차별 대입을 막고 있다. 정상 사용자가 걸렸다면 대기하거나 앱을 재기동한다.
API 레벨 rate limit 은 아직 없다(#132).

### 클라이언트가 RESOURCE_EXHAUSTED(또는 429)를 받는다

테넌트별 요청 상한(#132)에 걸린 것이다. 응답의 `retry-after`(초)만큼 기다리면 통과한다.

**먼저 판단할 것: 막아야 할 트래픽인가.** 거부가 뜬다고 곧장 상한을 올리면 남용을 허용하는 것이고,
곧장 남용으로 단정하면 정상 고객을 막는다. 후자가 더 흔하다.

```bash
# 얼마나 거부되고 있나
curl -s localhost:8083/actuator/prometheus | grep datapane_rate_limited_total

# 상한이 적용되고는 있나 — 0 이 아니면 제한기가 고장나 통과시키는 중이다
curl -s localhost:8083/actuator/prometheus | grep datapane_rate_limiter_errors_total

# 구독(SubscribeEvents)만 막히는 것도 같은 RESOURCE_EXHAUSTED 로 나온다 — 아래 두 계열로 구분한다
curl -s localhost:8083/actuator/prometheus | grep datapane_stream_subscriptions_rejected_total
curl -s localhost:8083/actuator/prometheus | grep datapane_stream_quota_errors_total
```

- **구독(`SubscribeEvents`)만 막히고 다른 RPC 는 멀쩡하다** → 요청율이 아니라 **동시 스트림 상한**이다
  (`datapane_stream_subscriptions_rejected_total` 이 오르고 `datapane_rate_limited_total` 은 그대로).
  위의 `REQUESTS_PER_SECOND`·`BURST` 를 올려도 증상이 그대로인 이유다. `.env` 의
  `REPUTATION_POOL_RATE_LIMIT_MAX_CONCURRENT_STREAMS` 를 올리거나, 클라이언트가 안 쓰는 구독을
  닫게 한다
- **정상 트래픽인데 막힌다** → `.env` 의 `REPUTATION_POOL_RATE_LIMIT_REQUESTS_PER_SECOND`·`_BURST` 를
  올리고 재배포. 기본값(10/s · burst 50)은 실측 없는 가설이다
- **남용이다** → 해당 API 키를 콘솔(`/keys`)에서 폐기한다. 상한을 낮추는 것보다 정확하다
- **지금 당장 풀어야 한다** → `REPUTATION_POOL_RATE_LIMIT_ENABLED=false` 후 재배포. 요청율 상한과 동시
  스트림 상한이 함께 사라지므로 임시 조치로만 쓴다

`acquire`(#148)는 fail-open 계약이라 SDK 가 이 거부를 예외로 던지지 않고 "조언 없음" 으로 다뤄야 한다.
고객 작업이 429 때문에 멈췄다면 그건 SDK 버그다.

### Grafana 에 접속이 안 된다

공개 도메인에 노출하지 않는다. SSH 터널로만 접근한다:

```bash
ssh -L 3001:127.0.0.1:3001 <user>@<서버>   # → http://localhost:3001
```

---

## 백업

### "백업 실패" 메일이 왔다

```bash
journalctl -u rp-backup-offsite.service -n 50 --no-pager
```

메일에 사유가 그대로 들어 있다. 자주 나오는 것:

- `백업 볼륨을 찾지 못했다` — compose 프로젝트 이름이 바뀌었다. `OFFSITE_VOLUME` 로 지정한다
- `OFFSITE_RETENTION_DAYS 는 0 이상의 정수여야 한다` — 설정 오타
- `업로드 검증 실패` — 올린 뒤 원격 크기가 다르다. 다음 실행이 자동 재업로드한다
- `덤프 크기가 다르다` — 볼륨에서 꺼내다 잘렸다(디스크 확인)

### 백업이 도는지 어떻게 아나

```bash
# 서버 볼륨
docker run --rm -v reputation-pool-cloud_reputation-pool-backups:/b alpine ls -lt /b

# 오프사이트
oci os object list --namespace <ns> --bucket-name rp-backups --prefix db/ --output table

# 원격 덤프가 실제로 읽히는지
./scripts/backup-offsite.sh --verify-latest
```

⚠️ **"아예 안 도는 것"은 아직 알림이 없다.** 실패하면 메일이 오지만, 타이머가 죽거나 서버가 꺼져 있으면
무신호다 — #131 에서 신선도 메트릭으로 다룬다. 그때까지는 월 1회 위 명령으로 확인한다.

### 볼륨이 비어 보인다

볼륨이 두 개다. `reputation-pool-cloud_backups`(빈 것)와
`reputation-pool-cloud_reputation-pool-backups`(실제). 뒤쪽을 본다.

---

## OCI

### `Out of host capacity` 가 계속 뜬다

**용량 문제이지 한도 문제가 아니다.** 서비스 한도는 남아 있는데 도쿄 리전에 A1 물리 서버가 비어 있지
않은 것이다.

```bash
oci limits resource-availability get --service-name compute \
  --limit-name standard-a1-core-count --compartment-id <tenancy> \
  --availability-domain <AD>       # available 이 남아 있으면 quota 가 아니다
```

`a1-hunter.service` 가 60초 간격으로 사냥한다. 사람이 할 일은 없다.

### OCI API 가 레이트 리밋(429)을 낸다

**SDK 의 기본 재시도가 스스로 리밋을 만든다.** 오라클은 용량 부족을 HTTP 500 으로 반환하는데 SDK 는
그것을 일시적 오류로 보고 자체 재시도한다 — `launch` 한 번이 요청 8개가 되어 90초 간격이어도 실제로는
분당 5회를 두드린 셈이 됐다. `--no-retry` 로 끄면 시도 1회 = 요청 1개다. 페이싱은 SDK 가 아니라 루프가
통제한다.

근거: PR #102

### 서버에서 `oci` 명령이 인증 실패한다

서버는 인스턴스 프린시펄로 인증한다. 확인 순서:

```bash
export OCI_CLI_AUTH=instance_principal
curl -sS -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/id   # 메타데이터
oci compute instance list --compartment-id <tenancy>                                    # 정책
```

메타데이터가 나오는데 API 가 거부하면 **IAM 정책 문제**다(dynamic group 의 matching rule 이 이 인스턴스
OCID 와 맞는지, 필요한 오퍼레이션이 화이트리스트에 있는지).

---

## 메일

### SMTP 인증이 실패한다 (`535 Authentication credentials invalid`)

자격증명 자체보다 **파싱**을 먼저 의심한다. `.env` 파일을 셸로 `source` 하면 비밀번호의 `[`·`$` 같은
문자를 셸이 해석해 값이 잘린다 — 증상은 인증 실패로만 보여 원인이 구분되지 않는다.

읽힌 값의 **길이**를 먼저 확인한다(값 자체를 출력하지 않는다):

```bash
python3 - <<'PY'
path = "/home/ubuntu/.rp-mail.env"
for line in open(path):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        print(f"{k}: {len(v)}자" if "PASS" in k else f"{k}: {v}")
PY
```

`SMTP_PASS` 길이가 발급받은 값과 다르면 파싱 문제다. 발송 경로 자체를 시험하려면:

```bash
echo "테스트" | python3 scripts/notify-mail.py "[reputation-pool] 발송 시험"
# 종료 코드: 0 성공 / 1 발송 실패 / 2 설정 없음·불완전
```

### 메일이 스팸함으로 간다

SPF/DKIM DNS 레코드가 없다. Cloudflare 에 넣는다:

```text
TXT    poolroost.com                    v=spf1 include:ap.rp.oracleemaildelivery.com ~all
CNAME  rp2026._domainkey.poolroost.com  rp2026.poolroost.com.dkim.nrt1.oracleemaildelivery.com
```

### 발송이 거부된다

OCI Email Delivery 는 **approved sender 로 등록된 주소만** 발신을 허용한다. 한도는 하루 100통 /
월 3,000통(영구 무료).

```bash
oci email sender list --compartment-id <tenancy> --output table
```

---

## 데이터

### 데모 데이터가 사라졌다

배포는 볼륨을 건드리지 않으므로 재배포로는 사라지지 않는다(앱이 기동하며 DB 에서 풀을 복원한다).
사라졌다면 `docker compose down -v` 가 돌았거나 볼륨이 삭제된 것이다. 복원:

```bash
# 서버 볼륨의 덤프로
./scripts/restore.sh

# 서버 자체가 없어졌다면 오프사이트에서
oci os object get --namespace <ns> --bucket-name rp-backups --name db/<파일> --file /tmp/dump
```

### Flyway 마이그레이션이 실패한다

앱이 기동하며 자동 마이그레이션한다(`V100__tenant_identity.sql` …). 실패하면 앱이 뜨지 않는다.

```bash
docker compose logs app | grep -i flyway
docker compose exec db psql -U reputation_pool -c 'select * from flyway_schema_history order by installed_rank desc limit 5;'
```

**실패한 마이그레이션을 손으로 지우기 전에 백업을 뜬다.** 스키마 이력을 건드리는 것은 되돌리기 어렵다.
