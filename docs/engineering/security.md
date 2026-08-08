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

## 콘솔 계정 — 어드민과 열람 전용(viewer)

콘솔 로그인은 두 개다. 둘 다 같은 `tenant` 에 묶이고, **할 수 있는 일**만 다르다.

- **admin** (`reputation-pool.admin.username/password`) — 운영자. 토큰에 `scope=admin` 이 실리고,
  리소스 차단·해제, API 키 발급·폐기, 테넌트 생성·정지·삭제를 할 수 있는 유일한 계정이다.
- **viewer** (`reputation-pool.admin.viewer-username/password`) — 열람 전용. 토큰에 `scope=viewer` 가
  실리고 `/api/**` 의 `GET`·`HEAD` 만 통과한다. 선택 설정이며, 비워 두면 뷰어 토큰은 발급되지 않는다.

**왜 나눴나.** 콘솔을 팀 밖에 보여주려면(데모 계정) 자격증명이 공개된다. 공개된 자격증명이 상태를 바꿀 수
있으면 안 된다. 그래서 "보여주기"와 "바꾸기"를 계정 수준에서 가른다 — 공개의 대가를 *콘솔이 이미 표시하는
것의 노출*로 한정한다.

**어디서 강제하나.** `SecurityConfiguration` 의 필터 체인에서 **HTTP 메서드**로 판정한다. 쓰기 경로를
나열하지 않는 이유는, 나열식 허용목록의 실패 방식이 "나중에 추가한 엔드포인트가 조용히 뚫리는 것"이기
때문이다. 메서드로 서술하면 이후에 생기는 쓰기 엔드포인트는 기본으로 admin 전용이 된다.

- 대시보드가 뷰어 세션에서 쓰기 버튼을 감추는 것은 **표시**이지 권한이 아니다. 버튼을 감춰도 curl 은 막지
  못한다 — 막는 것은 언제나 필터 체인이다.
- `scope` 클레임이 없는(이 기능 이전에 발급된) 토큰은 권한이 없으므로 쓰기가 거부된다. fail closed 이고,
  토큰 TTL 한 번이면 저절로 정리된다.
- 뷰어 자격증명도 admin 과 동일한 브루트포스 스로틀(#28)을 지나며, 잘못된 자격증명은 어느 계정을 노렸는지
  드러내지 않도록 두 자격 세트를 항상 모두 비교한다(상수시간 + 조기 반환 없음).
