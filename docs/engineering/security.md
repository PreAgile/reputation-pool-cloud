# 보안·인증·데이터 경계

- API key, DB credential, JWT/Cloud secret은 환경변수 또는 승인된 secret manager에서만 읽는다.
- 비밀값, 원문 API key, 결제정보, 민감한 tenant 데이터를 로그·메트릭·트레이스에 기록하지 않는다.
- 인증 실패와 권한 실패를 구분하되 tenant 존재 여부는 노출하지 않는다.
- tenant-scoped 조회·수정에는 서버가 결정한 tenant 경계를 사용한다. 요청 body의 tenant ID만 신뢰하지 않는다.
- 보안상 의심되는 경우 편의상 fallback을 추가하지 않고 fail closed를 우선한다.

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
- **관측성.** 차단 발동 시 WARN 로그(자격·사용자명 미기록, 소스 IP만)와 `auth.login.throttled` 카운터를 남긴다
  (#14/#45 알림 파이프라인 훅). 인메모리 구현(Caffeine 등 외부 의존성 없이 `ConcurrentHashMap` + `Clock` 만료).
- 설정: `reputation-pool.admin.login-throttle.*` (`enabled`, `max-attempts`, `window`, `block-duration`,
  `global-max-per-second`). 기본 활성.
