package io.github.preagile.reputationpool.cloud;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// reputation-pool-persistence 의존성이 PostgreSQL 드라이버와 Flyway를 classpath에 올리므로, 그대로 두면
// Spring Boot가 DataSource를 auto-configure 하고 컨텍스트 로드 시 실제 DB 연결을 시도한다. scaffold 단계
// (이슈 #1)에서는 아직 엔진 wiring이 없으니 해당 auto-configuration을 제외해 스모크 테스트가 인프라 없이 돌게 한다.
@SpringBootTest(
        properties = "spring.autoconfigure.exclude="
                + "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,"
                + "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration")
class ReputationPoolCloudApplicationTests {

    @Test
    void contextLoads() {}
}
