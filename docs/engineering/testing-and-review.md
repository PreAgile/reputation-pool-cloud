# 테스트·검증·리뷰

## 테스트

- 단위 테스트는 정상 경로와 인증 실패, 중복 요청, timeout, retry, partial failure를 다룬다.
- 클래스가 스레드 안전을 주장하면(javadoc·`Concurrent*` 자료구조·`synchronized`) 그 주장을 검증하는 동시성 테스트를 넣는다. 락을 지웠을 때 실제로 빨개지는지 확인한다 — 단일 스레드 테스트는 락을 통째로 지워도 전부 통과한다.
- 경계값은 0 과 max 만 짚지 않는다. 그 사이 부분값도 짚는다. 양 끝만 보면 "중간값을 늘 0 으로 계산한다" 같은 버그가 그대로 통과한다.
- 테스트를 다 쓴 뒤 검증 대상 로직을 **일부러 깨뜨려** 그 테스트가 실패하는지 본다. 실패하지 않으면 그 테스트는 그 버그를 못 잡는 것이다. "충분히 테스트했나"를 의견이 아니라 확인 가능한 절차로 만든다.
- PostgreSQL, Flyway, Spring context, gRPC 경계는 integration test로 검증한다.
- upstream protobuf/gRPC 계약은 cloud에서 복제하지 말고 소비자 호환성 테스트로 검증한다.
- 테스트를 완화하거나 삭제하면 PR에 이유를 기록한다.

### DisplayName 컨벤션

- 모든 테스트 클래스·메서드에 한글 `@DisplayName`을 붙여 리포트만 봐도 스펙이 읽히게 한다.
- 메서드명은 코드 컨벤션대로 영어로 두고(예: `swallowsSendFailure`), 설명은 `@DisplayName`으로 분리한다.
- 메서드 DisplayName은 "어떤 상황 → 어떤 결과" 형태로 쓴다. 예) `전송이 실패(IOException)해도 → 호출자에게 예외를 던지지 않고 삼킨다`.
- 클래스 DisplayName은 "대상 컴포넌트: 한 줄 책임" 형태로 쓴다. 예) `WebhookAlertNotifier: 활성일 때만 웹훅으로 비동기 POST 를 쏘는 알림 전송기`.
- 상황별 케이스가 많아지면 `@Nested`로 묶어 `대상 > 상황 > 결과` 트리를 만든다. 이때 `@Nested` 하위 클래스명은 영어로 둔다(예: `WhenActive`).
- 단, 글로벌 오픈소스에 보내는 코드(upstream PR 등)는 영어 DisplayName을 쓴다. 독자가 한국어인 사내 코드에만 한글을 적용한다.

## 검증 명령

변경 범위에 맞는 가장 좁은 검증부터 실행하고, 최종적으로 다음을 실행한다.

```bash
./gradlew build --no-daemon
./gradlew integrationTest --no-daemon
```

보안 의존성 변경 시에는 다음을 추가한다.

```bash
./gradlew dependencyCheckAnalyze --no-daemon
```

## PR

- 변경 범위, open-core 분류, 보안·tenant 영향, 실행한 검증을 기록한다.
- required CI 우회를 위해 `--no-verify`, 관리자 merge, check 삭제를 사용하지 않는다.
- CI가 녹색이어도 인증·tenant·데이터 경계는 사람이 검토한다.
