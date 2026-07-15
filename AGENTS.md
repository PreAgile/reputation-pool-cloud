# AGENTS.md

## 프로젝트 역할

`reputation-pool-cloud`는 공개 OSS `reputation-pool`을 Maven Central 아티팩트로 소비하는 비공개 호스티드 SaaS 레이어다.

- 공개 엔진의 도메인 로직·정책·포트·성능 개선은 `PreAgile/reputation-pool`로 보낸다.
- 이 레포에는 호스팅·인증·테넌시·미터링·과금·API 게이트웨이·배포·운영 코드를 둔다.
- 공개 레포를 fork하거나 엔진 소스를 복사하지 않는다.
- 엔진에 필요한 변경을 이 레포에서 우회 구현하지 말고 공개 레포 이슈/PR로 분리한다.

## 언어와 문서

- 문서·이슈·PR 설명·커밋 메시지는 한국어를 기본으로 한다.
- 코드 식별자·패키지명·API 필드명·로그의 구조화 키는 영어를 사용한다.
- 공개 OSS에 기여하는 코드와 메시지는 해당 저장소의 규칙을 따른다.
- 구현 전에 관련 이슈와 open-core 경계를 확인한다.

## 변경 작업 규칙

- 작은 수직 단위로 변경하고, 동작하는 검증을 같은 변경에 포함한다.
- 인증/테넌시/과금/미터링 변경은 기능 구현보다 격리·재시도·실패 시나리오를 먼저 검토한다.
- 엔진 버전은 명시적인 Maven Central release만 사용한다. dynamic version과 snapshot 의존을 금지한다.
- API 계약 변경은 backward compatibility와 migration/rollback 계획을 함께 기록한다.
- 외부 API와 결제 호출은 timeout, idempotency, retry 정책을 명시한다.
- 데이터베이스 변경은 migration과 rollback 영향을 검토한다.

## 보안 규칙

- API key, DB credential, JWT secret, Stripe secret, cloud credential을 코드·문서·테스트 fixture·로그에 넣지 않는다.
- 비밀값은 환경변수 또는 승인된 secret manager에서만 읽는다.
- 인증 실패와 권한 실패를 구분하고, 실패 응답에서 테넌트 존재 여부를 노출하지 않는다.
- 모든 tenant-scoped 조회·수정은 tenant 경계를 명시적으로 포함한다. 요청 body의 tenant ID만 신뢰하지 않는다.
- 로그·메트릭·트레이스에 credential, 원문 API key, 결제정보, 민감한 tenant 데이터를 기록하지 않는다.
- 보안상 의심되는 변경은 편의상 fallback을 추가하지 말고 fail closed를 우선한다.

## 테스트와 검증

코드가 존재하는 변경은 최소한 다음을 통과해야 한다.

```bash
./gradlew clean build --no-daemon
```

해당되는 경우 추가로 실행한다.

```bash
./gradlew integrationTest --no-daemon
./gradlew dependencyCheckAnalyze --no-daemon
```

- unit test는 정상 경로뿐 아니라 인증 실패, tenant cross-access, duplicate request, timeout, retry, partial failure를 검증한다.
- PostgreSQL/Testcontainers를 사용하는 경계는 integration test로 검증한다.
- 공개 엔진의 protobuf/gRPC 계약 검증은 cloud에서 중복 구현하지 말고 upstream 계약을 소비하는 호환성 테스트를 둔다.
- 테스트를 완화하거나 삭제하는 경우 이유를 PR에 기록한다.

## CI와 리뷰

- `main`에 직접 push하지 않는다.
- PR에는 변경 범위, open-core 분류, 보안/테넌시 영향, 검증 명령을 기록한다.
- required CI를 우회하기 위해 `--no-verify`, 관리자 merge, check 삭제를 사용하지 않는다.
- Gemini 리뷰는 필수 보조 리뷰로 사용하되, AI 결과만으로 승인/거부를 결정하지 않는다.
- Gemini가 지적한 내용은 근거가 있는지 코드와 테스트로 확인한 뒤 반영한다.
- CI가 녹색이어도 인증·테넌시·과금 경계는 사람이 별도로 검토한다.

## 작업 순서

1. 이슈의 목표와 open-core 경계를 확인한다.
2. 관련 공개 엔진 API와 현재 의존 버전을 확인한다.
3. 실패·보안·데이터 격리 시나리오를 먼저 정의한다.
4. 구현과 회귀 테스트를 함께 작성한다.
5. 포맷·빌드·통합 테스트·보안 검사를 실행한다.
6. PR에 검증 결과와 남은 리스크를 기록한다.
