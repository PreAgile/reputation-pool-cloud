# 보안·인증·데이터 경계

- API key, DB credential, JWT/Cloud secret은 환경변수 또는 승인된 secret manager에서만 읽는다.
- 비밀값, 원문 API key, 결제정보, 민감한 tenant 데이터를 로그·메트릭·트레이스에 기록하지 않는다.
- 인증 실패와 권한 실패를 구분하되 tenant 존재 여부는 노출하지 않는다.
- tenant-scoped 조회·수정에는 서버가 결정한 tenant 경계를 사용한다. 요청 body의 tenant ID만 신뢰하지 않는다.
- 보안상 의심되는 경우 편의상 fallback을 추가하지 않고 fail closed를 우선한다.

## 관리자 계정과 역할 (issue #31, 1차)

- 콘솔은 더 이상 단일 로그인이 아니다. 기존 `reputation-pool.admin.username/password/tenant` 는 **의미가
  그대로**인 전권 계정이고(그 키만 설정한 배포는 이전과 완전히 동일하게 동작한다), `admin.accounts[n]` 로
  **테넌트와 역할이 각자 다른 계정을 추가**할 수 있다. 역할은 `admin`(전권)과 `read-only` 둘이며,
  **생략하면 read-only** — 권한을 주는 쪽이 명시적 선택이어야 하고, 오타는 권한이 줄어드는 방향으로 나야 한다.
- **읽기 전용은 서버가 강제한다.** 대시보드에서 버튼을 감추는 것은 강제가 아니다. `AdminWriteAuthorizationFilter`
  가 JWT 인증 직후(=`TenantStatusFilter` 다음) 필터 체인에서 한 번에 판단한다:
  **안전 메서드(GET·HEAD·OPTIONS·TRACE)가 아닌 모든 요청**은 토큰의 `role` 클레임이 쓰기 권한을 가질 때만
  통과하고, 아니면 403 이다.
- **엔드포인트 목록이 아니라 메서드로 막는 이유**는 목록을 손으로 관리하면 새 엔드포인트를 빠뜨리는 것이
  곧 조용한 쓰기 구멍이기 때문이다. 메서드로 판단하면 내일 추가되는 엔드포인트도 생기는 즉시 막히고,
  반대 방향의 실수(안전한 엔드포인트를 잘못 막음)는 눈에 띄고 위험하지 않다.
- **역할은 토큰 클레임으로만 온다.** `tenant` 클레임과 같은 원칙 — 요청에서 받지 않는다. 클레임이 없거나
  모르는 값이면 **역할 없음**으로 보고 쓰기를 거부한다(fail closed). 그래서 이 기능 이전에 발급된 토큰은
  만료 전까지 조회는 되지만 쓰기는 안 되고, 다시 로그인하면 정상화된다.
- 적용 범위는 서블릿(REST 컨트롤 플레인)이다. gRPC 데이터 플레인은 테넌트별 API 키로 인증하며 콘솔 역할
  개념이 없다 — 서블릿 체인의 다른 규칙과 마찬가지로 영향받지 않는다.
- 관리 API 를 **자기 테넌트로 좁히는** 나머지 작업은 여전히 #31 에 남아 있다. 지금은 전권 토큰이면
  테넌트 생성·정지·삭제가 여전히 운영자 전역 행위다.

## 로그인 브루트포스 방어 (issue #28)

- `POST /api/auth/login`은 admin 자격을 추측할 수 있는 유일한 표면이므로 소스 IP 기준으로 스로틀한다.
- **계정 잠금이 아니라 IP 일시 차단.** v1은 단일 admin 계정이라 "계정 잠금"을 걸면 엔드포인트에 닿을 수 있는
  누구나 실제 운영자를 잠글 수 있는 self-DoS가 된다. 그래서 실패를 IP별로 세고, 그 IP만 일정 시간 차단한다.
- **2계층.** (L1) IP별 슬라이딩 윈도우 — `window` 안에서 `max-attempts`를 초과하면 그 IP를 `block-duration`
  동안 차단하고 `429 Too Many Requests` + `Retry-After`로 응답한다. 로그인 성공 시 해당 IP 카운터를 리셋한다.
  (L2) `global-max-per-second` — 각 IP가 개별 한도 아래로 유지되는 분산 스프레이에 대한 전역 초당 상한 안전판.
- 차단 응답 바디는 자격 정확 여부를 노출하지 않는 generic `ProblemDetail`이다(로그인 실패와 마찬가지로 존재
  여부 비노출 원칙 유지).
- **신뢰 프록시 IP.** 실제 클라이언트 IP는 `request.getRemoteAddr()`로 얻으며, `server.forward-headers-strategy:
  framework`로 Caddy(#15) 뒤의 `X-Forwarded-For` 실제 IP가 반영된다. 이는 신뢰 경계가 네트워크일 때만 안전하다 —
  8083 포트는 리버스 프록시만 접근 가능해야 하고 앱을 외부에 직접 노출하면 안 된다(그러지 않으면 `X-Forwarded-For`
  위조로 스로틀 우회·타 IP 프레이밍이 가능). 이 전제를 강제하려고 `compose.yaml`은 app의 8083/9093을 loopback
  (`127.0.0.1`)에만 바인딩한다 — 브라우저는 Caddy(`:8080`)로만 접근하고, 8083을 `0.0.0.0`에 재노출하지 않는다.
- **프록시가 공개되면 loopback 바인딩만으로는 부족하다(#15).** 8083이 닫혀 있어도 Caddy 자체가 인터넷에 열리면
  아무나 `X-Forwarded-For: <임의 IP>`를 실어 보낼 수 있고, Caddy의 기본 동작은 그 값에 **append**이며 Spring의
  `ForwardedHeaderFilter`는 **첫** 항목을 쓴다 — 즉 공격자가 넣은 값이 채택되어 위조 구멍이 그대로 돌아온다.
  그래서 `Caddyfile.prod`는 `header_up X-Forwarded-For {remote_host}`로 헤더를 **덮어쓴다**(append 아님).
  Cloudflare proxied 뒤에서 진짜 클라이언트 IP(`CF-Connecting-IP`)를 다시 신뢰해도 되는 조건과 절차는
  [`deployment.md`](deployment.md)의 "오리진 잠그기"에 있다.
- **관측성.** 차단 발동 시 WARN 로그(자격·사용자명 미기록, 소스 IP만)와 `auth.login.throttled` 카운터를 남긴다
  (#14/#45 알림 파이프라인 훅). 인메모리 구현(Caffeine 등 외부 의존성 없이 `ConcurrentHashMap` + `Clock` 만료).
- 설정: `reputation-pool.admin.login-throttle.*` (`enabled`, `max-attempts`, `window`, `block-duration`,
  `global-max-per-second`). 기본 활성.
