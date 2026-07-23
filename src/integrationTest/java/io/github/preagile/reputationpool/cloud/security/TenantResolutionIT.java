package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import java.sql.Connection;
import java.sql.ResultSet;
import javax.sql.DataSource;
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
 * Full-context integration test (Testcontainers PostgreSQL) proving the tenant-identity wiring against
 * a real database: the cloud-owned schema (V100) migrates alongside the persistence jar's V1/V2, the
 * startup {@link ApiKeySeeder} maps the configured env key to the default tenant, and the resolver
 * reads it back. An unknown key resolves to nothing (fail closed).
 *
 * <p>{@code grpc.server.port=0} keeps this context's gRPC server off the fixed port so it can coexist
 * with other integration contexts in the same run. Requires Docker; runs via
 * {@code ./gradlew integrationTest}, off the Docker-free {@code build} gate.
 */
@DisplayName("TenantResolutionIT: 실제 PostgreSQL 에서 시드된 env 키의 테넌트 매핑과 클라우드/업스트림 스키마 공존을 검증하는 통합테스트")
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

    @Autowired
    private TenantRepository tenants;

    @Test
    @DisplayName("시작 시 시드된 env API 키를 조회하면 → default 테넌트로 해석된다")
    void seededEnvKeyResolvesToDefaultTenant() {
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("integration-key")))
                .contains("default");
    }

    @Test
    @DisplayName("등록되지 않은 키를 조회하면 → 어떤 테넌트로도 해석되지 않는다(fail closed)")
    void unknownKeyResolvesToNothing() {
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("not-a-key"))).isEmpty();
    }

    @Test
    @DisplayName("테넌트를 정지하면 → 유효·미폐기 키여도 해석되지 않고(gRPC 차단), 재활성화하면 → 다시 해석된다(#83)")
    void suspendingTenantBlocksKeyResolutionAndReactivatingRestoresIt() {
        // default 테넌트의 시드 키는 처음엔 해석된다(active).
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("integration-key")))
                .contains("default");

        // 정지하면 키가 유효·미폐기여도 status='active' 조건에서 걸러져 아무 테넌트로도 해석되지 않는다.
        tenants.updateStatus("default", TenantStatus.SUSPENDED);
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("integration-key")))
                .isEmpty();

        // 재활성화하면 접근이 복구된다.
        tenants.updateStatus("default", TenantStatus.ACTIVE);
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256("integration-key")))
                .contains("default");
    }

    @Test
    @DisplayName("마이그레이션을 적용하면 → 클라우드 스키마(V100)와 업스트림 스키마(V1/V2) 테이블이 한 DB 에 공존한다")
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
