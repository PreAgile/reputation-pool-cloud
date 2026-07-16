package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.persistence.PostgresAuditTrail;
import io.github.preagile.reputationpool.persistence.PostgresResourceStore;
import java.time.Clock;
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
 * <p>Scope note: this module depends only on core + persistence. The gRPC broadcaster and its
 * {@code CompositeEventSink} live in the (unconsumed) server module, so for now the pool's only sink
 * is the audit trail; issue #3 introduces a cloud-side broadcaster and fans out to both.
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
     * The assembled pool: the same graph as {@code AdvisorServer.assemble}, minus the gRPC parts. The
     * pool is not restored here — {@link PoolLifecycle#start()} does that after Flyway has migrated and
     * before any traffic.
     */
    @Bean
    ResourcePool reputationPool(Clock clock, PostgresAuditTrail auditTrail, ReputationPoolProperties props) {
        ReputationEngine engine = new ReputationEngine(
                new AdaptiveCooldownPolicy(),
                props.engine().windowSize(),
                props.engine().coolAfter(),
                props.engine().recoverAfter());
        return new ResourcePool(
                engine,
                new WeightedRandomSelectionStrategy(),
                auditTrail,
                clock,
                RandomGenerator.getDefault(),
                props.leaseTtl());
    }
}
