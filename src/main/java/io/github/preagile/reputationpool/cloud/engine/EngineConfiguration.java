package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import io.github.preagile.reputationpool.grpc.CompositeEventSink;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresAuditTrail;
import io.github.preagile.reputationpool.persistence.PostgresResourceStore;
import java.time.Clock;
import java.util.List;
import java.util.function.Function;
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
 * jar's {@code V1__snapshot}/{@code V2__audit}/{@code V3__pool_id} schema against it before these beans
 * are used).
 *
 * <p>Scope note: this module depends only on core + persistence + grpc, so the gRPC broadcaster and the
 * {@code CompositeEventSink} are cloud-side ports of the (unconsumed) server module's classes. Pool
 * events fan out to both the live gRPC stream and the durable audit trail.
 *
 * <p><b>Per-tenant isolation (#9b).</b> There is no single pool or single store bean any more: the
 * {@link PerTenantPoolRegistry} owns one pool + one tenant-scoped store per tenant, created lazily. The
 * {@code clock}, the fan-out event sink, and the audit trail are shared across tenants; pool state and
 * its persisted rows are not.
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
     * The sink every tenant's pool emits through: the same {@code AdvisorServer.assemble} fan-out to
     * both the live gRPC {@link EventBroadcaster} and the durable audit trail. Shared across tenants
     * (event-stream and audit isolation are a deferred follow-up), so each per-tenant pool is handed
     * this one sink.
     */
    @Bean
    EventSink poolEventSink(EventBroadcaster broadcaster, PostgresAuditTrail auditTrail) {
        return new CompositeEventSink(List.of(broadcaster, auditTrail));
    }

    /**
     * Makes a tenant's snapshot store: a {@link PostgresResourceStore} confined to the tenant's
     * {@code pool_id} namespace (V3). This is the one place the concrete persistence type and the
     * {@link DataSource} meet the registry, so the registry itself stays persistence-agnostic.
     */
    @Bean
    Function<String, ResourceStore> resourceStoreFactory(DataSource dataSource, Clock clock) {
        return tenantId -> new PostgresResourceStore(dataSource, clock, tenantId);
    }

    /**
     * The real per-tenant registry: one pool + one tenant-scoped store per tenant, created lazily.
     * Replaces the interim {@link SinglePoolTenantRegistry}, so an authenticated call is routed to its
     * own tenant's isolated pool. {@link PoolLifecycle} restores/checkpoints each tenant's pool through
     * this registry; the control plane (#11) creates tenants via
     * {@link TenantPoolRegistry#onboard(String)}.
     */
    @Bean
    PerTenantPoolRegistry tenantPoolRegistry(
            Clock clock,
            EventSink poolEventSink,
            ReputationPoolProperties props,
            TenantRepository tenantRepository,
            Function<String, ResourceStore> resourceStoreFactory) {
        return new PerTenantPoolRegistry(clock, poolEventSink, props, tenantRepository, resourceStoreFactory);
    }
}
