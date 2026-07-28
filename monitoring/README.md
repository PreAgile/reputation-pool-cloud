# 모니터링 (#14 / D7b)

`docker compose up` 시 앱과 함께 뜨는 Prometheus + Grafana 스택. 앱이 `/actuator/prometheus`로
노출하는 Micrometer 지표를 긁어 시각화한다.

## 구성

| 서비스 | 역할 | 노출 |
|--------|------|------|
| `prometheus` | `app:8083/actuator/prometheus` 를 15초마다 스크레이프, 시계열 저장, `slo-rules.yml`(SLI) + `alerts.yml`(알림) 평가. 보존 32일(#79 — 30일 버짓 계산에 필요, 기본값은 15일) | 호스트 미노출(compose 내부 전용) |
| `alertmanager` | firing 알림을 받아 grouping/dedup/silence/정비창 처리 후 receiver 로 통지(#76) | 호스트 미노출(compose 내부 전용) |
| `grafana` | Prometheus 데이터소스 + 프로비저닝된 대시보드 | `127.0.0.1:3001` (loopback, 로컬 확인용) |

- SLO 목표와 에러버짓: **[`docs/engineering/slo.md`](../docs/engineering/slo.md)**
- 대시보드: `http://localhost:3001` (기본 admin/admin — 프로덕션은 `GRAFANA_ADMIN_PASSWORD` 주입)
- 대시보드 JSON·데이터소스·스크레이프·알림은 전부 `monitoring/` 아래에 코드로 프로비저닝된다.

## 보안 posture

`/actuator/prometheus` 는 `SecurityConfiguration` 에서 **permitAll** 이지만 **외부에 노출되지 않는다**:

- 앱은 `127.0.0.1` 로만 바인딩되고, 브라우저가 보는 Caddy(:80)는 `/actuator/prometheus` 를 **404 로 차단**한다.
- 따라서 스크레이프는 **compose 네트워크 내부의 Prometheus** 만 가능하다 — 신뢰 경계는 네트워크다.
- `health`/`info` 는 그대로 public(헬스 카드·프로브용).

## 지표

지금 대시보드/알림이 쓰는 지표는 이미 노출된 것들:

- `http_server_requests_seconds_*` — 가용성(5xx 비율)·지연(p50/p99)
- `hikaricp_connections_*` — DB 커넥션 풀
- `jvm_*` — 힙 등 런타임
- `reputation_*_total` — 도메인 이벤트(lease/block/cool/recover, #68)
- `grpc_server_processing_duration_seconds_*` — gRPC 데이터플레인 지연·상태코드(#78)
- `reputation_alert_*_surge_threshold` — 급증 알림 임계값 자체(#77, 아래 참고)
- `reputation_pool_checkpoint_*` — 체크포인트 신선도·주기·실패(#80, 아래 참고)
- `reputation_pool_restore_failures_total` — 기동 시 풀 복원 실패(#80)
- `slo:*:bad_ratio_rate*` · `slo:*:bad_events_*` — SLI 파생 시계열(#79, `slo-rules.yml` 이 계산)

## 알림

룰은 세 갈래다(#79 이후). Prometheus 가 전부 평가하고(Prometheus UI 의 Alerts/ALERTS 시계열로도 확인 가능),
firing 알림은 `prometheus.yml` 의 `alerting.alertmanagers` 배선을 통해 `alertmanager` 서비스로 넘어가 실제
통지 라우팅까지 이어진다(#76).

| 갈래 | 파일 · 그룹 | 성격 | 등급 |
|---|---|---|---|
| **에러버짓 소진율** | `alerts.yml` · `reputation-pool-error-budget` (지표는 `slo-rules.yml`) | 사용자가 겪는 **증상**을 SLO 목표에서 도출된 소진율로 평가 | `critical`(page) + `warning` |
| **원인·포화 신호** | `alerts.yml` · `reputation-pool-signals` | 사용자가 겪기 *전에* 또는 *증상 없이* 나빠지는 것(DB풀·도메인 급증·체크포인트) | `warning` |
| **워치독** | `alerts.yml` · `reputation-pool-liveness` + `*MetricMissing` | 알림 자체가 고장 났음을 알린다 | `critical`/`warning` |

**page 를 울릴 자격이 있는 것은 첫 갈래뿐이다.** 원인 신호를 소진율로 승격하지 않는 이유는
`alerts.yml` 상단 주석에 있다.

### SLO 목표 수치

**`docs/engineering/slo.md` 가 유일한 출처다.** 목표·버짓·티어 표·조정 절차·알려진 한계가 거기 있다.
요약하면 데이터 플레인(gRPC) 가용성 99.5%·지연 99%@500ms, 컨트롤 플레인(HTTP) 둘 다 99% — 모두 30일 창.

### 스크레이프 대상 생존 (#79)

`TargetDown` 이 이 룰 집합의 전제다. #79 전까지 모든 룰이 "앱이 내보낸 지표"를 소비했으므로 **앱이 죽으면
전부 조용해졌다.** `up` 은 Prometheus 가 스스로 만드는 시계열이라 앱과 무관하게 존재하고, 그래서
`absent()` 워치독을 붙일 수 있는 유일한 지점이다(SLI 비율에는 붙일 수 없다 — 한가한 시간대에 정상적으로
사라지므로 평상시에 울린다).

### 룰 검증 (CI 에서 자동)

CI 의 `deploy-config` 잡이 `promtool` 로 두 단계를 돌린다 — 로컬에서도 같은 명령으로 확인할 수 있다:

```bash
docker run --rm -v "$PWD/monitoring:/w:ro" -w /w --entrypoint promtool prom/prometheus:v3.1.0 \
  check rules alerts.yml slo-rules.yml   # 문법
docker run --rm -v "$PWD/monitoring:/w:ro" -w /w --entrypoint promtool prom/prometheus:v3.1.0 \
  test rules alerts-test.yml        # 의미: 시계열을 주입해 발화 여부·라벨·주석을 단정
```

`alerts-test.yml` 이 있는 이유: 문법이 맞는데도 **조용히 발화하지 않는 룰**이 가장 위험하다(임계값 시계열
이름이 바뀌었거나, 집계에서 라벨을 잃었거나). 룰을 고치면 이 테스트도 같이 고친다.

> **룰 파일을 추가할 때는 세 곳을 함께 고쳐야 한다** — `prometheus.yml` 의 `rule_files`, `compose.yaml` 의
> prometheus 볼륨 마운트, `ci.yml` 의 `check rules` 인자. 글롭이 아니라 명시 목록이라 하나만 빠뜨리면
> 컨테이너가 기동에 실패하거나(마운트 누락) 검증을 빠져나간다(CI 인자 누락).

### 급증 임계값 조정 (운영자)

`ResourceCoolingSurge` 와 `UpstreamBlockingSurge` 의 임계값은 룰 파일에 박혀 있지 않고 **앱 설정에서
온다.** Prometheus 는 룰 파일에서 환경변수를 치환하지 않으므로, 앱이 값을 게이지로 노출하고 룰이 그
시계열과 비교한다:

| 환경변수 | 기본값 | 의미 |
|---|---|---|
| `REPUTATION_POOL_COOLING_SURGE_THRESHOLD` | `10` | 전체 냉각 전이 **분당** 건수 |
| `REPUTATION_POOL_BLOCKING_SURGE_THRESHOLD` | `1` | `BLOCKED` 원인 냉각 **분당** 건수 |

부수 효과로 Grafana "냉각 원인별 비율" 패널에 임계선이 점선으로 함께 그려져 **남은 여유가 눈에 보인다.**

**두 기본값은 실측 없는 가설이다** (`limits` 와 같은 posture). 도출된 것은 둘의 *비율*뿐이다 — 한
`(리소스, 컨텍스트)` 짝은 쿨다운이 끝나기 전에 다시 냉각 이벤트를 내지 못하고(core
`ReputationEngine.shouldCool`), 첫 쿨다운이 `SLOW` 60초 대 `BLOCKED` 7200초로 120배 차이나므로, 같은
분당 건수가 원인에 따라 전혀 다른 규모를 뜻한다.

실트래픽이 쌓인 뒤 조정하는 절차:

1. **평상시 값을 관측한다.** Grafana "냉각 원인별 비율" 패널에서 사고가 없던 구간의 전체 합산과 `BLOCKED`
   값을 각각 읽는다(최소 1주 — 요일·시간대 편차가 보일 만큼).
2. **그 배수로 잡는다.** 평상시의 **300%** 정도가 출발점이다 — 정상 변동에는 안 울리고 실제 급증에는
   울리는 지점. 오탐이 잦으면 400~500%로, 사고를 놓쳤으면 200%로 옮긴다.
3. **`BLOCKED` 은 더 낮게 둔다.** 쿨다운이 2시간이라 값 자체가 원래 작다. 평상시가 0에 가까우면 배수가
   무의미하므로 절대값(예: `0.5`)으로 잡되, 0 보다는 커야 한다.
4. `.env` 에 넣고 재배포한다(`./scripts/bootstrap.sh`). 값은 `/actuator/prometheus` 의
   `reputation_alert_cooling_surge_threshold` 로 확인한다.

> 임계값을 **자동 산정**하는 것(#88 이상탐지 → #90 정책 자동 튜닝)은 v2 트랙이다. 데이터가 쌓이기 전에는
> 계산할 근거가 없고(#88 자체가 "데이터 임계점 전에는 착수 보류"라고 적어 뒀다), *"울리면 임계를 올린다"*
> 는 방식은 지속형 장애에서 정확히 침묵하게 되므로 채택하지 않는다. 임계값을 목표에서 **도출**하는
> 정석 경로는 #79(SLO + 에러버짓 + multi-burn-rate)이고 이제 구현돼 있다 — `docs/engineering/slo.md` 참고.
>
> `0` 이나 음수는 부팅 시 거부한다 — 룰을 끄려면 `alerts.yml` 에서 해당 룰을 지운다.
>
> 임계값 게이지가 사라지면 두 급증 룰은 비교 대상이 없어 조용히 무동작한다. `SurgeThresholdMetricMissing`
> 워치독이 그 경우를 잡는다.

### 체크포인트 신선도 (#80)

이 앱의 풀 상태는 **메모리에 살고** `checkpoint-interval`(기본 30초)마다 통째로 DB 에 저장된다. 저장이
실패해도 메모리로 계속 정상 응답하므로 **지연·에러율·도메인 지표가 전혀 움직이지 않는다** — 증상 없는
고장이고, 피해는 재시작하는 순간 그동안의 상태가 사라지며 드러난다.

`reputation_pool_checkpoint_age_seconds` 가 그 간격을 잰다: **마지막으로 "모든 테넌트가" 저장에 성공한
뒤 흐른 시간.** 한 테넌트만 실패해도 갱신되지 않는다 — 그러지 않으면 실패하는 테넌트가 건강한 이웃 뒤에
영영 숨는다.

- **정상은 톱니다.** 0 과 주기 사이를 오르내린다. 평평한 0 을 기대하면 안 된다.
- **기동 직후는 0 에서 시작**해 첫 성공까지 증가한다. 배포마다 알림이 울리지 않으면서, 한 번도 성공하지
  못하면 정상적으로 임계를 넘는다.
- **알림 임계는 주기의 3배**이고 룰이 `reputation_pool_checkpoint_interval_seconds` 게이지에서 파생시킨다
  — 주기를 바꾸면 임계가 따라 움직이므로 두 값이 어긋날 수 없다(#77 과 달리 새 환경변수를 만들지 않았다).

> **복원 실패는 별개이고 더 나쁘다.** 기동 시 어떤 테넌트의 스냅샷을 읽지 못하면 그 테넌트는 **빈 풀로
> 체크포인트 대상에 남고**, 다음 라운드가 그 빈 스냅샷을 정상 저장본 위에 덮어쓴다 — 되돌릴 수 없다.
> 이때 저장 자체는 성공하므로 **신선도 지표는 건강하게 보인다.** 유일한 신호가
> `reputation_pool_restore_failures_total` 이고 `PoolRestoreFailed` 룰이 그걸 본다.
> 덮어쓰기 자체를 막는 것(저장 건너뛰기 / 해당 테넌트 서빙 거부)은 가용성 트레이드오프가 있는 동작
> 변경이라 별도 이슈로 다룬다.

## 알림 라우팅

### 역할 분담 (하이브리드)

이 레포는 알림을 두 경로로 나눈다 — 서로 대체하지 않는다:

| 경로 | 대상 | 특징 |
|------|------|------|
| in-app 웹훅(`WebhookAlertNotifier`, #45) | 즉시성이 중요한 도메인 이벤트(`ResourceBlocklisted` 등) | 엔진이 사실을 발생시키는 즉시 비동기 POST. grouping/dedup 없음 — 사실 하나당 알림 하나. |
| Alertmanager(`monitoring/alertmanager.yml`, #76) | SLO성 알림(`alerts.yml` 의 가용성·지연·DB풀·차단급증·gRPC 룰) | Prometheus 가 평가한 firing 알림을 grouping(`group_by`)·dedup·silence·정비창까지 처리한 뒤 receiver 로 통지. |

SLO 알림의 grouping/dedup/silence 를 in-app 코드로 재구현하지 않는다 — Alertmanager 가 이미 그 역할을
전담하는 표준 도구이기 때문이다. `WebhookAlertNotifier` 는 이번 작업으로 **코드 변경 없이** 그대로 남는다.

### 기본은 무통합(dark-ship)

`monitoring/alertmanager.yml` 의 `default` receiver 는 커밋 상태로 **아무 integration 도 없다** — 이
레포가 반복해온 관례(`AlertProperties.enabled` 기본 `false`, `REPUTATION_POOL_ALERTS_ENABLED` 기본
`false`)와 동일하게, 실제 webhook URL 을 주입하지 않아도 `docker compose up` 이 그대로 성공한다.
Alertmanager 자체는 동작하며(라우팅·grouping·dedup 은 살아있음) 그저 어디로도 통지를 내보내지 않는 상태다.

> **주의** — `REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL` 은 **빈 값이어도 정의는 돼 있어야** 한다.
> `compose.yaml` 의 `secrets: <name>: environment:` 소스는 컨테이너 생성 시점에 변수를 요구하므로, 변수가
> 아예 없으면 `docker compose up` 이 `environment variable ... required by file ... is not set` 으로
> 실패한다(`docker compose config` 는 통과하므로 `up` 에서만 드러난다). 그래서 `.env.example` 은 다른
> optional 변수들과 달리 이 변수를 주석 처리하지 않고 빈 값으로 정의해 둔다 — `cp .env.example .env` 를
> 그대로 따르면 신경 쓸 일이 없고, 프로덕션에서도 webhook 을 쓰지 않더라도 빈 값으로 주입해야 한다.

### 실제 webhook 연결 (운영자)

1. `REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL` 에 실제 webhook URL 을 설정(`.env` 또는 프로덕션 시크릿 스토어).
2. `compose.yaml` 최상위 `secrets:` 가 Compose Spec 의 `environment:` 소스로 그 값을 파일
   (`/run/secrets/alertmanager_webhook_url`)로 자동 마운트한다 — 커스텀 entrypoint 스크립트나 `envsubst`
   렌더링이 필요 없다(`backup`/`restore` 사이드카와 달리 이 경로엔 별도 스크립트가 없다).
3. `monitoring/alertmanager.yml` 의 `receivers[].webhook_configs` 주석을 해제한다 — `url_file` 이 위 경로를
   가리키므로 URL 문자열 자체는 커밋되는 설정 파일에 전혀 담기지 않는다.
4. `docker compose up -d alertmanager` (또는 `docker compose restart alertmanager`)로 반영.

이 방식을 고른 이유: `webhook_configs` 는 `url` 대신 `url_file` 을 지원하고(Alertmanager 가 시작/리로드
시 파일에서 읽음), Compose Spec 의 `secrets: <name>: environment:` 소스는 호스트 환경변수 값을 파일로
자동 마운트하는 최신 기능이라 커스텀 entrypoint 나 `envsubst` 템플릿 렌더링 없이 조합이 그대로 된다
(둘 다 로컬에서 `docker compose config`/`amtool check-config` 로 검증 완료 — 채택 배경은 PR 본문 참고).

### 수동 검증 런북 (이슈 #76 수용 기준)

`docker compose up -d prometheus alertmanager grafana` 로 스택을 띄운 뒤:

1. **receiver 도달 확인** — 합성 알림을 Alertmanager API 에 직접 주입한다(로컬에 `amtool` 이 없으면 curl):
   ```bash
   curl -XPOST http://localhost:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{
     "labels": {"alertname": "SmokeTest", "severity": "warning"},
     "annotations": {"summary": "수동 검증용 합성 알림"},
     "startsAt": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"
   }]'
   ```
   (Alertmanager 포트를 호스트에 임시로 열었다면 `localhost:9093`, 아니면 컨테이너 안에서 실행하거나
   `docker compose exec alertmanager` 로 `amtool alert add alertname=SmokeTest severity=warning` 사용.)
   Alertmanager UI(`http://localhost:9093`, 임시 포트 노출 시) 또는 `GET /api/v2/alerts` 로 알림이
   `default` receiver 로 그룹핑됐는지 확인한다. 실제 webhook 을 붙였다면 해당 엔드포인트가 POST 를
   받는지도 확인한다.
2. **resolved 통지 확인** — 같은 alertname 으로 `endsAt` 을 채워 다시 POST 하거나, 실제 Prometheus 룰이
   조건을 벗어나 알림이 스스로 resolve 되게 둔다. `webhook_configs.send_resolved: true` 라면 resolved
   알림도 receiver 로 간다.
3. **동일 조건 반복 억제 확인(`repeat_interval: 4h`)** — 1번 알림을 다시 그대로 주입해도
   `repeat_interval` 이내에는 receiver 로 재통지되지 않는지 확인한다(`group_interval: 5m` 이내 후속
   알림도 재그룹핑되어 새 통지를 만들지 않는지 함께 확인).

## 후속

- core observability 포트(0.4.0 릴리스 후) Micrometer 어댑터 → 리스 지연 Timer·이용률 Gauge·거절율 카운터 추가
- Alertmanager severity 별 라우팅 분기(receiver 2개 이상일 때), Grafana 외부 노출·인증(#15)
- 급증 임계값(`surge-thresholds`) 절대 수치 재조정 — **#79 에서 하지 않았다.** 위 "급증 임계값 조정" 절차가
  1단계로 "평상시 값을 최소 1주 관측"을 요구하는데 프로덕션 트래픽이 없어 실행할 수 없다. SLO 목표는
  선언으로 정할 수 있지만 급증 임계는 관측이 있어야 정해진다 — 실트래픽 1주 후 별도로 조정한다
- 복원 실패 시 덮어쓰기 방지(#80 후속) — 지금은 관측만 한다. 저장 건너뛰기 vs 서빙 거부의 가용성 트레이드오프 결정 필요
- 알림·메트릭 테넌트 귀속(#81) — 지금 도메인 카운터는 테넌트 전역 합산이라, 한 테넌트의 급증이 전체 알림을 울린다
- 임계값 자동 산정: 시계열 이상탐지(#88) → 정책 자동 튜닝(#90, core advisor). 데이터 축적 후 v2 트랙
