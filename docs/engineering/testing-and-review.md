# 테스트·검증·리뷰

## 테스트

- 단위 테스트는 정상 경로와 인증 실패, 중복 요청, timeout, retry, partial failure를 다룬다.
- PostgreSQL, Flyway, Spring context, gRPC 경계는 integration test로 검증한다.
- upstream protobuf/gRPC 계약은 cloud에서 복제하지 말고 소비자 호환성 테스트로 검증한다.
- 테스트를 완화하거나 삭제하면 PR에 이유를 기록한다.

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
