# 아키텍처와 책임 경계

## Cloud가 담당하는 것

- Spring Boot 애플리케이션 구성
- core/persistence 아티팩트 배선
- gRPC API 노출
- API key 인증
- PostgreSQL 연결과 Flyway migration
- snapshot 복원·저장 및 운영 배포

## Upstream이 담당하는 것

- reputation 결정 로직과 정책
- 도메인 타입·불변식·port
- lease 동시성 보장
- persistence 구현 자체의 변경

upstream 변경이 필요하면 cloud에서 우회하지 말고 upstream 이슈와 PR로 분리한다.
