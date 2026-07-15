# 보안·인증·데이터 경계

- API key, DB credential, JWT/Cloud secret은 환경변수 또는 승인된 secret manager에서만 읽는다.
- 비밀값, 원문 API key, 결제정보, 민감한 tenant 데이터를 로그·메트릭·트레이스에 기록하지 않는다.
- 인증 실패와 권한 실패를 구분하되 tenant 존재 여부는 노출하지 않는다.
- tenant-scoped 조회·수정에는 서버가 결정한 tenant 경계를 사용한다. 요청 body의 tenant ID만 신뢰하지 않는다.
- 보안상 의심되는 경우 편의상 fallback을 추가하지 않고 fail closed를 우선한다.
