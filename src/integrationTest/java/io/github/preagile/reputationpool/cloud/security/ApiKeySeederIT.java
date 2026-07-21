package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Integration test (Testcontainers PostgreSQL) for the seeder's reconcile semantics against a real
 * database: it is idempotent under repeat (proving the {@code ON CONFLICT} path, hence no duplicate-key
 * startup failure when instances cold-start together), and env-key rotation activates the new key while
 * revoking the previous seed key — in both directions. Its own context/container so its writes never
 * disturb {@link TenantResolutionIT}.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@DisplayName("ApiKeySeederIT: 실제 PostgreSQL 에서 API 키 시더의 재실행 멱등성과 양방향 키 로테이션을 검증하는 통합테스트")
@SpringBootTest(properties = {"reputation-pool.auth.api-key=bootstrap-key", "grpc.server.port=0"})
@Import(ApiKeySeederIT.Containers.class)
class ApiKeySeederIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private TenantResolver resolver;

    @Autowired
    private DataSource dataSource;

    private void reconcile(String apiKey) throws Exception {
        new ApiKeySeeder(dataSource, new SecurityProperties(apiKey), Clock.systemUTC())
                .run(new DefaultApplicationArguments());
    }

    @Test
    @DisplayName("같은 키로 재시드하면 멱등하게 유지되고, 새 키로 로테이션 후 되돌리면 → 새 키 활성·이전 키 폐기가 양방향으로 반영된다")
    void reconcilesIdempotentlyAndRotatesBothWays() throws Exception {
        // The app's own startup seeder already activated "bootstrap-key" for the default tenant.
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("bootstrap-key")))
                .contains("default");

        // Idempotent: re-running with the same key must not fail (ON CONFLICT) and leaves it active.
        reconcile("bootstrap-key");
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("bootstrap-key")))
                .contains("default");

        // Rotate: the new key becomes active, the previous seed key is revoked.
        reconcile("rotated-key");
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("rotated-key")))
                .contains("default");
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("bootstrap-key")))
                .isEmpty();

        // Rotate back: a previously revoked key is re-activated (ON CONFLICT DO UPDATE clears revoked_at).
        reconcile("bootstrap-key");
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("bootstrap-key")))
                .contains("default");
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("rotated-key")))
                .isEmpty();
    }
}
