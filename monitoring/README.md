# 모니터링 (#14 / D7b)

`docker compose up` 시 앱과 함께 뜨는 Prometheus + Grafana 스택. 앱이 `/actuator/prometheus`로
노출하는 Micrometer 지표를 긁어 시각화한다.

## 구성

| 서비스 | 역할 | 노출 |
|--------|------|------|
| `prometheus` | `app:8083/actuator/prometheus` 를 15초마다 스크레이프, 시계열 저장, `alerts.yml` 규칙 평가 | 호스트 미노출(compose 내부 전용) |
| `alertmanager` | firing 알림을 받아 grouping/dedup/silence/정비창 처리 후 receiver 로 통지(#76) | 호스트 미노출(compose 내부 전용) |
| `grafana` | Prometheus 데이터소스 + 프로비저닝된 대시보드 | `127.0.0.1:3001` (loopback, 로컬 확인용) |

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

## 알림(SLO)

`monitoring/alerts.yml` 에 SLO 규칙을 정의한다(가용성·지연·DB풀·차단 급증 등). Prometheus 가 룰을 평가하고
(Prometheus UI 의 Alerts/ALERTS 시계열로도 확인 가능), firing 알림은 `prometheus.yml` 의
`alerting.alertmanagers` 배선을 통해 `alertmanager` 서비스로 넘어가 실제 통지 라우팅까지 이어진다(#76).

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
`false`)와 동일하게, 시크릿을 주입하지 않아도 `docker compose up` 이 그대로 성공한다. Alertmanager 자체는
동작하며(라우팅·grouping·dedup 은 살아있음) 그저 어디로도 통지를 내보내지 않는 상태다.

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
