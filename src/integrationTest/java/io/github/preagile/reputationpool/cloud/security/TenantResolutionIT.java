package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.ResultSet;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full-context integration test (Testcontainers PostgreSQL) proving the tenant-identity wiring against
 * a real database: the cloud-owned schema (V100) migrates alongside the persistence jar's V1/V2, the
 * startup {@link ApiKeySeeder} maps the configured env key to the default tenant, and the resolver
 * reads it back. An unknown key resolves to nothing (fail closed).
 *
 * <p>{@code grpc.server.port=0} keeps this context's gRPC server off the fixed port so it can coexist
 * with other integration contexts in the same run. Requires Docker; runs via
 * {@code ./gradlew integrationTest}, off the Docker-free {@code build} gate.
 */
@SpringBootTest(properties = {"reputation-pool.auth.api-key=integration-key", "grpc.server.port=0"})
@Import(TenantResolutionIT.Containers.class)
class TenantResolutionIT {

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

    @Test
    void seededEnvKeyResolvesToDefaultTenant() {
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("integration-key")))
                .contains("default");
    }

    @Test
    void unknownKeyResolvesToNothing() {
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("not-a-key"))).isEmpty();
    }

    @Test
    void cloudSchemaCoexistsWithUpstreamSchema() throws Exception {
        assertThat(tableExists("tenant")).isTrue(); // cloud V100
        assertThat(tableExists("api_key")).isTrue(); // cloud V100
        assertThat(tableExists("snapshot_meta")).isTrue(); // upstream V1
        assertThat(tableExists("audit_event")).isTrue(); // upstream V2
    }

    private boolean tableExists(String table) throws Exception {
        try (Connection connection = dataSource.getConnection();
                ResultSet tables = connection.getMetaData().getTables(null, null, table, null)) {
            return tables.next();
        }
    }
}
