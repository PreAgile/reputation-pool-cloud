# 개발 방법론

## Tactical DDD

- cloud의 경계는 hosting, authentication, tenant, operations다.
- `reputation-pool` core의 도메인 모델과 정책을 복제하지 않는다.
- Spring 설정·gRPC 어댑터·저장소 구현은 도메인 정책과 분리한다.
- 전략적 DDD나 다중 bounded context 설계는 실제 요구가 생길 때 도입한다.

## TDD

기본 흐름은 red → green → refactor다.

1. 실패하는 동작 테스트를 작성한다.
2. 최소 구현으로 통과시킨다.
3. 중복과 구조를 정리한다.

## BDD 스타일

- 테스트 이름과 구조는 사용자·운영자 관점의 동작을 설명한다.
- gRPC 계약, 인증 실패, 복원·저장, 종료 flush를 시나리오로 표현한다.
- Cucumber 도입은 요구가 생기기 전까지 하지 않는다.

## 변경 원칙

- API 계약 변경에는 호환성 및 migration/rollback 영향을 기록한다.
- 외부 호출에는 timeout, retry, idempotency를 명시한다.
- 데이터베이스 변경에는 migration과 rollback 영향을 함께 검토한다.
