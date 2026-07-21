# 모니터링 (#14 / D7b)

`docker compose up` 시 앱과 함께 뜨는 Prometheus + Grafana 스택. 앱이 `/actuator/prometheus`로
노출하는 Micrometer 지표를 긁어 시각화한다.

## 구성

| 서비스 | 역할 | 노출 |
|--------|------|------|
| `prometheus` | `app:8083/actuator/prometheus` 를 15초마다 스크레이프, 시계열 저장, `alerts.yml` 규칙 평가 | 호스트 미노출(compose 내부 전용) |
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

`monitoring/alerts.yml` 에 SLO 규칙을 정의한다(가용성·지연·DB풀·차단 급증). 현재 Prometheus 가 **평가만**
하며(Prometheus UI 의 Alerts/ALERTS 시계열로 확인), Alertmanager 로 실제 통지 라우팅하는 것은 #15 후속이다.

## 후속

- core observability 포트(0.4.0 릴리스 후) Micrometer 어댑터 → 리스 지연 Timer·이용률 Gauge·거절율 카운터 추가
- Alertmanager 통지 라우팅, Grafana 외부 노출·인증(#15)
