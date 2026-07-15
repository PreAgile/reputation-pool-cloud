# AGENTS.md

`reputation-pool-cloud`는 공개 `reputation-pool` 엔진을 소비하는 Spring Boot
호스팅 레이어다. 엔진의 도메인 정책·성능·포트 변경은
[`PreAgile/reputation-pool`](https://github.com/PreAgile/reputation-pool)에서 처리한다.

## 반드시 지킬 원칙

- 엔진 소스를 복사하거나 cloud에서 우회 구현하지 않는다.
- 변경은 작은 수직 단위로 만들고, 관련 검증을 함께 추가한다.
- 명시된 Maven Central release만 의존한다. snapshot/dynamic version은 사용하지 않는다.
- 비밀값과 민감한 tenant 데이터는 코드·테스트 fixture·로그에 남기지 않는다.
- 인증·권한·tenant 경계는 fail closed를 기본으로 한다.
- `main`에 직접 커밋하지 않고 PR로 작업한다.

## 작업 전 확인

1. 관련 이슈와 open-core 경계를 확인한다.
2. upstream API와 현재 의존 버전을 확인한다.
3. 실패·보안·데이터 격리 시나리오를 먼저 정의한다.

## 상세 규칙

- 개발 방법론: [`docs/engineering/development-methodology.md`](docs/engineering/development-methodology.md)
- 아키텍처와 open-core 경계: [`docs/engineering/architecture.md`](docs/engineering/architecture.md)
- 보안·인증·tenant 규칙: [`docs/engineering/security.md`](docs/engineering/security.md)
- 테스트·검증·PR 규칙: [`docs/engineering/testing-and-review.md`](docs/engineering/testing-and-review.md)

상세 규칙이 현재 이슈의 범위를 벗어나면 해당 문서를 불필요하게 적용하지 않는다.
