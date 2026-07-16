package io.github.preagile.reputationpool.cloud;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.grpc.ReputationAdvisorService;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresResourceStore;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full-context integration test against a real PostgreSQL (Testcontainers). Proves the whole #2 wiring
 * boots — Spring Boot's DataSource, Flyway migrating the persistence jar's V1/V2 schema, and the engine
 * beans — and that the pool's snapshot survives a checkpoint→reload round-trip through the real store.
 *
 * <p>The container is a {@link Bean} (not a static {@code @Container}) so its lifecycle is tied to the
 * application context: it stays up until after the context — and thus {@code PoolLifecycle}'s final
 * checkpoint on shutdown — has finished, instead of being torn down first and leaving the final
 * checkpoint to hit a dead connection.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the Docker-free {@code build} gate.
 */
@SpringBootTest
@Import(EngineWiringIT.Containers.class)
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
    private ResourcePool pool;

    @Autowired
    private PostgresResourceStore store;

    @Autowired
    private ReputationAdvisorService advisorService;

    @Autowired
    private EventBroadcaster broadcaster;

    @Test
    void contextBoots_andSnapshotSurvivesRoundTripThroughRealStore() {
        ResourceId proxy = new ResourceId(ResourceKind.PROXY, "p1");
        pool.register(proxy);

        store.save(pool.snapshot());
        Optional<PoolSnapshot> loaded = store.load();

        assertThat(loaded).isPresent();
        assertThat(loaded.get().registered()).contains(proxy);
    }

    @Test
    void grpcSurfaceIsWiredFromTheSharedModule() {
        // cloud's thin @GrpcService subclass and the shared broadcaster bean are both present, so the
        // engine is reachable over gRPC without cloud owning any of the contract/adapter code.
        assertThat(advisorService).isNotNull();
        assertThat(broadcaster).isNotNull();
    }
}
