package io.github.preagile.reputationpool.cloud.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Integration test (Testcontainers PostgreSQL) for {@link TenantRepository} against the real
 * {@code tenant} table (migration V100). The startup seeder has already created the {@code default}
 * tenant, so this also proves the table + repository line up end to end.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@DisplayName("TenantRepositoryIT: 실제 PostgreSQL 의 tenant 테이블에서 저장/조회/목록이 동작하는지 검증하는 통합테스트")
@SpringBootTest(properties = {"reputation-pool.auth.api-key=it-key", "grpc.server.port=0"})
@Import(TenantRepositoryIT.Containers.class)
class TenantRepositoryIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private TenantRepository repository;

    @Test
    @DisplayName("테넌트를 저장하면 id 로 조회되고 없는 id 는 비며, 목록엔 → 시드된 default 와 방금 만든 acme 가 함께 나온다")
    void createsFindsAndLists() {
        repository.create(new Tenant("acme", "Acme Corp", "active", Instant.parse("2026-07-17T00:00:00Z")));

        assertThat(repository.findById("acme")).get().extracting(Tenant::name).isEqualTo("Acme Corp");
        assertThat(repository.findById("missing")).isEmpty();
        // "default" is seeded at startup from REPUTATION_POOL_API_KEY; "acme" is the row just created.
        assertThat(repository.findAll()).extracting(Tenant::id).contains("default", "acme");
    }
}
