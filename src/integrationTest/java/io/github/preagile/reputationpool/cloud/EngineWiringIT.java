package io.github.preagile.reputationpool.cloud;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry.ManagedPool;
import io.github.preagile.reputationpool.cloud.grpc.ReputationAdvisorService;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresResourceStore;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
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
 * Full-context integration test against a real PostgreSQL (Testcontainers). Proves the whole cloud
 * wiring boots — Spring Boot's DataSource, Flyway migrating the persistence jar's V1/V2/V3 schema plus
 * cloud's V100, the per-tenant registry, and the gRPC surface — and, at the center of #9b, that two
 * tenants' checkpoints are isolated by {@code pool_id}: saving one tenant's snapshot never deletes the
 * other tenant's rows (the whole-replace {@code DELETE} is narrowed to a single {@code pool_id}).
 *
 * <p>The container is a {@link Bean} (not a static {@code @Container}) so its lifecycle is tied to the
 * application context: it stays up until after the context — and thus {@code PoolLifecycle}'s final
 * checkpoint on shutdown — has finished, instead of being torn down first.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the Docker-free {@code build} gate.
 */
@SpringBootTest(properties = "grpc.server.port=0")
@Import(EngineWiringIT.Containers.class)
@DisplayName("EngineWiringIT: 실제 PostgreSQL 위에서 클라우드 전체 배선이 부팅되고 테넌트 체크포인트가 pool_id 로 격리되는지 검증하는 통합테스트")
class EngineWiringIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private PerTenantPoolRegistry registry;

    @Autowired
    private TenantRepository tenantRepository;

    @Autowired
    private ReputationAdvisorService advisorService;

    @Autowired
    private EventBroadcaster broadcaster;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("컨텍스트를 띄우면 → 테넌트별 풀 레지스트리와 gRPC 표면(어드바이저·브로드캐스터)이 모두 주입된다")
    void contextBoots_withThePerTenantRegistryAndGrpcSurfaceWired() {
        assertThat(registry).isNotNull();
        assertThat(advisorService).isNotNull();
        assertThat(broadcaster).isNotNull();
    }

    @Test
    @DisplayName("두 테넌트가 각자 체크포인트를 저장하면 → 한쪽 저장이 다른 쪽 행을 지우지 않고 pool_id 로 격리된다")
    void twoTenantsCheckpointWithoutErasingEachOther() {
        tenantRepository.create(new Tenant(
                "tenant-a",
                "Tenant A",
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                Instant.parse("2026-07-17T00:00:00Z")));
        tenantRepository.create(new Tenant(
                "tenant-b",
                "Tenant B",
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                Instant.parse("2026-07-17T00:00:00Z")));

        ResourceId proxyA = new ResourceId(ResourceKind.PROXY, "a-proxy");
        ResourceId proxyB = new ResourceId(ResourceKind.ACCOUNT, "b-account");

        ManagedPool a = registry.manage("tenant-a");
        ManagedPool b = registry.manage("tenant-b");

        // Tenant A registers and checkpoints first...
        a.pool().register(proxyA);
        a.store().save(a.pool().snapshot());

        // ...then tenant B registers and checkpoints. B's save whole-replaces only pool_id = 'tenant-b'
        // rows, so it must not touch tenant A's persisted state.
        b.pool().register(proxyB);
        b.store().save(b.pool().snapshot());

        // Each tenant's store reads back exactly its own resource — A survived B's save (pool_id isolation).
        Optional<PoolSnapshot> loadedA = a.store().load();
        Optional<PoolSnapshot> loadedB = b.store().load();
        assertThat(loadedA).isPresent();
        assertThat(loadedA.get().registered()).containsExactly(proxyA);
        assertThat(loadedB).isPresent();
        assertThat(loadedB.get().registered()).containsExactly(proxyB);

        // A brand-new store over the same DataSource, scoped to tenant A's pool_id, sees only tenant A —
        // proving the isolation is in the persisted rows, not just the in-memory pools.
        ResourceStore freshA = new PostgresResourceStore(dataSource, Clock.systemUTC(), "tenant-a");
        assertThat(freshA.load()).isPresent();
        assertThat(freshA.load().get().registered()).containsExactly(proxyA);
    }
}
