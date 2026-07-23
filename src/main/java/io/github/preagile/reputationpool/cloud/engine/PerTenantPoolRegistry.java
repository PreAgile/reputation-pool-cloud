package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.metering.MeterRecorder;
import io.github.preagile.reputationpool.cloud.metering.TenantMeteringSink;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import io.github.preagile.reputationpool.grpc.CompositeEventSink;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresAuditTrail;
import java.time.Clock;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.random.RandomGenerator;

/**
 * The real {@link TenantPoolRegistry}: one {@link ResourcePool} per tenant, each backed by its own
 * tenant-scoped {@code ResourceStore} (pool id = tenant id) so no tenant's state can read or overwrite
 * another's. This is what makes cloud actually multi-tenant-safe — the interim
 * {@link SinglePoolTenantRegistry} shared one pool across every tenant, which was correct only for a
 * single tenant.
 *
 * <p><b>What is per-tenant vs shared.</b> Each tenant gets its own pool (isolated in-memory state), its
 * own store (isolated persisted rows, keyed by {@code pool_id}), and — since #29 — its own event stream
 * and audit history: {@link #build} joins the broadcaster's and audit trail's {@code forPool(tenantId)}
 * views into the tenant's sink, so one tenant's live gRPC subscriber never sees another's events (paired
 * with cloud's {@code subscriptionPoolId()} override on the advisor service, which scopes each
 * subscription to its tenant) and one tenant's audit rows are written under its own {@code pool_id}. The
 * {@code clock} and the global fan-out sink (alerting + metrics, which aggregate across tenants) are the
 * only <em>shared</em> pieces.
 *
 * <p><b>The store seam.</b> Stores are made by an injected {@code storeFactory} (tenant id &rarr;
 * store), so the composition root owns the concrete {@code PostgresResourceStore(dataSource, clock,
 * poolId)} construction and this class stays free of any persistence type — which also lets tests drive
 * it with in-memory stores, Docker-free.
 *
 * <p><b>Lazy, dynamic creation.</b> A pool is built on first reference (an authenticated request via
 * {@link #poolFor} or an explicit {@link #onboard} when the control plane creates a tenant) and cached.
 * Building only wires the pool and store; restoring from the store is the lifecycle's job
 * ({@link PoolLifecycle} fans restore out across {@link #knownTenantIds()} before traffic), which keeps
 * the reference server's "assemble, then restore" split. A tenant reaching {@code poolFor} was
 * authenticated against the {@code api_key}&rarr;{@code tenant} mapping, so it is always legitimate; the
 * only tenants built after startup are ones created at runtime, which have no prior snapshot to restore.
 */
public final class PerTenantPoolRegistry implements TenantPoolRegistry {

    /** A tenant's pool paired with its tenant-scoped store, so the lifecycle can restore/checkpoint each. */
    public record ManagedPool(String tenantId, ResourcePool pool, ResourceStore store) {}

    private final ConcurrentHashMap<String, ManagedPool> pools = new ConcurrentHashMap<>();

    private final Clock clock;
    private final EventBroadcaster broadcaster;
    private final PostgresAuditTrail auditTrail;
    private final EventSink sharedSink;
    private final ReputationPoolProperties properties;
    private final TenantRepository tenantRepository;
    private final Function<String, ResourceStore> storeFactory;
    private final MeterRecorder meterRecorder;

    public PerTenantPoolRegistry(
            Clock clock,
            EventBroadcaster broadcaster,
            PostgresAuditTrail auditTrail,
            EventSink sharedSink,
            ReputationPoolProperties properties,
            TenantRepository tenantRepository,
            Function<String, ResourceStore> storeFactory,
            MeterRecorder meterRecorder) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.broadcaster = Objects.requireNonNull(broadcaster, "broadcaster must not be null");
        this.auditTrail = Objects.requireNonNull(auditTrail, "auditTrail must not be null");
        this.sharedSink = Objects.requireNonNull(sharedSink, "sharedSink must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.tenantRepository = Objects.requireNonNull(tenantRepository, "tenantRepository must not be null");
        this.storeFactory = Objects.requireNonNull(storeFactory, "storeFactory must not be null");
        this.meterRecorder = Objects.requireNonNull(meterRecorder, "meterRecorder must not be null");
    }

    @Override
    public ResourcePool poolFor(String tenantId) {
        return manage(tenantId).pool();
    }

    @Override
    public void onboard(String tenantId) {
        manage(tenantId);
    }

    @Override
    public void evict(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        // Remove the pool+store pair so subsequent poolFor/manage calls will not resurrect it during a
        // delete. Dropping the reference is enough — the pool holds only in-memory state and the store is
        // a thin JDBC adapter with no resources to release; the durable rows are removed separately by the
        // lifecycle's DB cascade.
        pools.remove(tenantId);
    }

    /** Builds (idempotently) and returns the managed pool+store pair for {@code tenantId}. */
    public ManagedPool manage(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        return pools.computeIfAbsent(tenantId, this::build);
    }

    /** The pools built so far — the set the lifecycle checkpoints on each interval. */
    public Collection<ManagedPool> managedPools() {
        return List.copyOf(pools.values());
    }

    /**
     * Every tenant that should have its pool restored at startup: the persisted tenants (from the
     * {@code tenant} table) unioned with any already built at runtime. On a restart the tenant rows
     * survive, so this enumerates exactly the pools with a snapshot to restore.
     */
    public Set<String> knownTenantIds() {
        Set<String> ids = new LinkedHashSet<>();
        for (Tenant tenant : tenantRepository.findAll()) {
            ids.add(tenant.id());
        }
        ids.addAll(pools.keySet());
        return ids;
    }

    private ManagedPool build(String tenantId) {
        // One store confined to this tenant's pool_id namespace: its save() deletes/inserts only this
        // tenant's rows and its load() reads only this tenant's rows.
        ResourceStore store = storeFactory.apply(tenantId);
        ReputationEngine engine = new ReputationEngine(
                new AdaptiveCooldownPolicy(),
                properties.engine().windowSize(),
                properties.engine().coolAfter(),
                properties.engine().recoverAfter());
        // Fan out to this tenant's own event stream and audit history (the broadcaster's and audit
        // trail's forPool(tenantId) views, #29), the global fan-out sink (alerting + metrics), and a
        // tenant-bound metering sink. The tenant is fixed by which pool emitted — no tenant field on the
        // event — so a live gRPC subscriber (scoped by the advisor service's subscriptionPoolId() override)
        // only sees its own tenant's events and audit rows land under its pool_id.
        EventSink tenantSink = new CompositeEventSink(List.of(
                broadcaster.forPool(tenantId),
                auditTrail.forPool(tenantId),
                sharedSink,
                new TenantMeteringSink(tenantId, meterRecorder)));
        ResourcePool pool = new ResourcePool(
                engine,
                new WeightedRandomSelectionStrategy(),
                tenantSink,
                clock,
                RandomGenerator.getDefault(),
                properties.leaseTtl());
        return new ManagedPool(tenantId, pool, store);
    }
}
