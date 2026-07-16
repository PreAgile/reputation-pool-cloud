package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.github.preagile.reputationpool.grpc.CompositeEventSink;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresAuditTrail;
import io.github.preagile.reputationpool.persistence.PostgresResourceStore;
import java.time.Clock;
import java.util.List;
import java.util.random.RandomGenerator;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * The Spring composition root for the reputation engine — the {@code AdvisorServer.assemble} recipe
 * from the public repo, expressed as beans. It assembles the pure engine, the persistence adapter
 * (restored-from / checkpointed-to store, plus the audit trail as the pool's event sink), and the
 * production defaults (system clock, entropy-seeded randomness). The durable lifecycle itself —
 * restore-on-start, periodic checkpoint, retention purge, final checkpoint — lives in
 * {@link PoolLifecycle}.
 *
 * <p>The {@link DataSource} is Spring Boot's auto-configured one (Flyway migrates the persistence
 * jar's {@code V1__snapshot}/{@code V2__audit} schema against it before these beans are used).
 *
 * <p>Scope note: this module depends only on core + persistence, so the gRPC broadcaster and the
 * {@code CompositeEventSink} are cloud-side ports of the (unconsumed) server module's classes. Pool
 * events fan out to both the live gRPC stream and the durable audit trail.
 */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@EnableConfigurationProperties(ReputationPoolProperties.class)
public class EngineConfiguration {

    /** Production clock. A test can replace this bean with {@code Clock.fixed(...)} for determinism. */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** The durable snapshot store the pool is restored from at startup and checkpointed to. */
    @Bean
    PostgresResourceStore resourceStore(DataSource dataSource) {
        return new PostgresResourceStore(dataSource);
    }

    /**
     * The audit trail — both the pool's {@code EventSink} and the target of the retention purge.
     * {@code close()} is its inferred destroy method (it is {@link AutoCloseable}), so Spring flushes
     * the trail's tail on shutdown, after {@link PoolLifecycle} has taken its final checkpoint.
     */
    @Bean
    PostgresAuditTrail auditTrail(DataSource dataSource) {
        return new PostgresAuditTrail(dataSource);
    }

    /** Adapts the concrete trail's purge to the {@link AuditPurger} seam the lifecycle depends on. */
    @Bean
    AuditPurger auditPurger(PostgresAuditTrail auditTrail) {
        return auditTrail::purgeOlderThan;
    }

    /**
     * The gRPC event broadcaster from the shared grpc module — both a pool {@code EventSink} and the
     * {@code ReputationAdvisorService}'s subscription registry. It is a plain (framework-agnostic) class
     * there, so cloud registers it as a bean; {@code close()} completes open streams on shutdown.
     */
    @Bean(destroyMethod = "close")
    EventBroadcaster eventBroadcaster() {
        return new EventBroadcaster();
    }

    /**
     * The assembled pool: the same graph as {@code AdvisorServer.assemble}. Pool events fan out through
     * a {@link CompositeEventSink} to both the live gRPC {@link EventBroadcaster} and the durable audit
     * trail — the pool still holds exactly one sink, so the core stays untouched. The pool is not
     * restored here — {@link PoolLifecycle#start()} does that after Flyway has migrated and before any
     * traffic.
     */
    @Bean
    ResourcePool reputationPool(
            Clock clock, EventBroadcaster broadcaster, PostgresAuditTrail auditTrail, ReputationPoolProperties props) {
        ReputationEngine engine = new ReputationEngine(
                new AdaptiveCooldownPolicy(),
                props.engine().windowSize(),
                props.engine().coolAfter(),
                props.engine().recoverAfter());
        EventSink sink = new CompositeEventSink(List.of(broadcaster, auditTrail));
        return new ResourcePool(
                engine,
                new WeightedRandomSelectionStrategy(),
                sink,
                clock,
                RandomGenerator.getDefault(),
                props.leaseTtl());
    }
}
