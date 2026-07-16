package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import javax.sql.DataSource;
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
