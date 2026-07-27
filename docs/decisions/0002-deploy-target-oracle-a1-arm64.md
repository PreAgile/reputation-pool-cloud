# ADR 0002 — 배포 타깃으로 Oracle Cloud Always Free A1(arm64) 채택, 이미지는 CI에서 발행

- 상태: 채택됨 (accepted)
- 맥락: #15 프로덕션 인프라 (D8)
- 관련: `compose.prod.yaml`, `Caddyfile.prod`, `.github/workflows/release.yml`, `scripts/bootstrap.sh`,
  [`docs/engineering/deployment.md`](../engineering/deployment.md)

## 배경

지금까지 배포 형태는 "private 서버 + Docker Compose 단일 호스트"로만 정해져 있었고 **어느 서버인지**가 비어
있었다. 랜딩(#16)과 대시보드(#12)가 완성돼 실제로 공개할 대상이 생겼으므로 타깃을 확정해야 한다.

제약이 두 가지다.

1. **비용 0.** 포트폴리오 데모이므로 월 구독을 지불할 이유가 없다.
2. **상시 가동.** 면접관이 링크를 클릭하는 시점을 고를 수 없다. "필요할 때 켠다"가 성립하지 않고, 90일 뒤
   꺼지는 것도 성립하지 않는다.

현재 스택은 컨테이너 8개(db·app·dashboard·caddy·prometheus·alertmanager·grafana·backup), 합계 3~4GB를 쓴다.
JVM + Postgres 조합의 병목은 코어가 아니라 **메모리**다.

## 결정

**Oracle Cloud Always Free의 Ampere A1 Flex(2 OCPU / 12GB, arm64) 단일 인스턴스**를 배포 타깃으로 한다.
근거:

1. **만료 절벽이 없다.** Always Free는 기간 개념이 없다. 크레딧 기반 무료(GCP 90일, AWS 6개월, Azure 12개월)는
   *소진이 아니라 만료로* 끝나므로 "아껴 써서 오래 버티기"가 성립하지 않는다. 30일 체험 크레딧을 유료 전환 없이
   흘려보내면 계정이 Always Free로 내려앉고 리소스는 계속 돈다 — 크레딧이 필수 자원에서 **선택적 보너스**로
   격하된다.
2. **사양이 충족된다.** 12GB는 현재 필요량의 3배 여유다. A1은 SMT가 없어 `1 OCPU = 1 물리코어 = 1 vCPU`이므로
   2 OCPU는 SMT 경쟁 없는 전용 코어 2개다. 같은 12GB급을 GCP에서 빌리면 월 $49~98이라 $300 크레딧이 정확히
   3개월에 소진된다.
3. **ARM 이식 비용이 0이다.** `eclipse-temurin:25`, `postgres:17`, `caddy:2`, `prom/prometheus`,
   `prom/alertmanager`, `grafana/grafana` 전부 arm64 멀티아치를 제공한다. Compose 단일 호스트를 택한 결정이
   여기서 이득으로 회수된다.
4. **장애 격리가 가능하다.** 랜딩·문서는 Cloudflare Pages에 두어, Oracle 장애나 계정 사고가 포트폴리오 표면을
   죽이지 못한다.

함께 결정한 것: **이미지는 CI에서 굽고 서버는 pull만 한다.** 2 OCPU에서 Gradle `bootJar` + `next build`를 돌리면
코어를 수 분간 점유하고 빌드 메모리가 서비스와 경쟁한다. public 레포에 무료로 제공되는 arm64 호스티드 러너
(`ubuntu-24.04-arm`)로 네이티브 빌드해 GHCR에 발행하면 QEMU 에뮬레이션도 필요 없다. `linux/arm64` 단일
아키텍처만 발행한다 — amd64 이미지의 소비자가 없다(로컬·CI는 소스에서 빌드한다).

## 대안과 기각 사유

| 대안 | 강점 | 기각 이유 |
|---|---|---|
| **GCP $300 크레딧 (90일)** | 사양 선택 자유, 관리형 서비스 생태계 | 크레딧 조달 자체가 실패했다(기존 계정은 유료 전환됨, 신규는 `OR-CAC-35`로 결제 프로필 생성 거부). 받았더라도 90일 만료 절벽은 지출과 무관하게 고정이고, 12GB급은 월 $49~98이라 3개월에 소진된다 |
| **AWS·Azure 프리티어 릴레이** | 각각 6개월·12개월 | 둘 다 A1보다 사양이 낮다(Azure B1s는 1 vCPU/**1GB**). 90일~1년마다 VM 재구축·DB 이전·DNS 전환 노동을 지불하고 **도착지가 결국 Oracle**이다. "가입이 계속 성공한다"를 전제하는데 그 전제가 이미 깨졌다 |
| **계정을 더 만들어 크레딧 우회** | — | ToS 위반이다. 검토 대상이 아니다 |
| **유료 VPS (Hetzner 등 월 $5선)** | 안정적, x86, SLA | 제약 1(비용 0)에 어긋난다. Always Free가 사양을 충족하는 상황에서 지불할 이유가 없다. 무료 티어가 축소·폐지되면 이 대안으로 온다 |
| **관리형 PaaS (Fly.io·Railway·Render 무료 티어)** | 배포 편의 | 무료 티어의 메모리가 256MB~512MB급이라 JVM+Postgres 8컨테이너가 들어가지 않는다. 유휴 시 슬립되어 "상시 가동"도 깨진다 |

## 결과

- 배포 명령이 `docker compose -f compose.yaml -f compose.prod.yaml up -d`로 고정되고, `scripts/bootstrap.sh`가
  빈 호스트에서 이 상태까지 멱등하게 데려간다. 재구축이 문서 따라가는 수작업이 아니라 스크립트 1회다.
- **오버레이가 base의 개발 편의 노출을 닫는다.** base `compose.yaml`의 `5435:5432`(Postgres)는 `0.0.0.0`
  바인딩이라 공개 서버에서 그대로 두면 DB가 인터넷에 열린다. 오버레이가 이 포트와 base의 평문 `Caddyfile`
  마운트를 제거하며, CI(`deploy-config` 잡)가 두 항목이 실제로 닫혔는지 검증한다.
- **컨테이너 메모리 상한이 JVM 힙의 단일 조절점이 된다.** `Dockerfile`이 `-XX:MaxRAMPercentage=70`으로 cgroup
  상한을 읽으므로, 호스트가 1 OCPU/6GB로 줄어도 compose의 `limits.memory`만 내리면 힙이 따라 줄어든다.
- **프록시를 공개하면 loopback 바인딩만으로는 XFF 신뢰 경계가 유지되지 않는다.** ADR 0001이 남긴 전제("8083은
  Caddy만 접근 가능")는 Caddy 자체가 인터넷에 열리는 순간 부족해진다 — 아무나 `X-Forwarded-For`를 실어 보낼 수
  있고 Caddy의 기본 동작은 append이며 Spring은 첫 항목을 쓴다. 그래서 `Caddyfile.prod`는 XFF를 `{remote_host}`로
  **덮어쓴다**. 실제 클라이언트 IP를 되찾는 조건(오리진을 Cloudflare IP 범위로 제한)은
  [`deployment.md`](../engineering/deployment.md) "오리진 잠그기"에 있다.
- 무료 티어 리스크는 계층 분리로 흡수한다: 랜딩·문서가 Cloudflare Pages에 있어 Oracle 사고가 공개 표면을 죽이지
  않고, DB에 보존할 실데이터가 없어 이전 비용이 시드 스크립트 재실행으로 대체된다.

## 재검토 트리거

- **A1 용량을 끝내 확보하지 못할 때** → 유료 VPS(Hetzner 등 월 $5선)로 간다. 이식 비용은 낮다(같은 compose,
  x86이면 이미지만 멀티아치로 발행).
- **무료 티어가 더 축소되거나 폐지될 때** — 2026-06에 4 OCPU/24GB → 2 OCPU/12GB로 무공지 반토막된 전례가 있다.
  6GB 미만으로 내려가면 위와 같다.
- **실사용 트래픽이 붙어 SLA가 필요해질 때** → 무료 티어에 SLA는 없다. 유료 인스턴스 또는 관리형 DB로 이동.
- **멀티 인스턴스가 필요해질 때** → 인메모리 풀의 상태 소유 모델(#85)이 먼저 풀려야 한다. 단일 호스트 전제가
  거기에 걸려 있다.
