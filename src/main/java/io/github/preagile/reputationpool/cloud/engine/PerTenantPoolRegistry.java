package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.github.preagile.reputationpool.core.port.ResourceStore;
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
 * <p><b>What is per-tenant vs shared.</b> Each tenant gets its own pool (isolated in-memory state) and
 * its own store (isolated persisted rows, keyed by {@code pool_id}). The {@code clock}, the pool
 * {@code EventSink} (the gRPC broadcaster + audit trail fan-out), and the audit trail itself are
 * <em>shared</em> — event-stream isolation (so one tenant's subscriber never sees another's events) is
 * deliberately deferred to a follow-up, as is per-tenant audit. Only pool state and lease decisions are
 * isolated here.
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
    private final EventSink sharedSink;
    private final ReputationPoolProperties properties;
    private final TenantRepository tenantRepository;
    private final Function<String, ResourceStore> storeFactory;

    public PerTenantPoolRegistry(
            Clock clock,
            EventSink sharedSink,
            ReputationPoolProperties properties,
            TenantRepository tenantRepository,
            Function<String, ResourceStore> storeFactory) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.sharedSink = Objects.requireNonNull(sharedSink, "sharedSink must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.tenantRepository = Objects.requireNonNull(tenantRepository, "tenantRepository must not be null");
        this.storeFactory = Objects.requireNonNull(storeFactory, "storeFactory must not be null");
    }

    @Override
    public ResourcePool poolFor(String tenantId) {
        return manage(tenantId).pool();
    }

    @Override
    public void onboard(String tenantId) {
        manage(tenantId);
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
        ResourcePool pool = new ResourcePool(
                engine,
                new WeightedRandomSelectionStrategy(),
                sharedSink,
                clock,
                RandomGenerator.getDefault(),
                properties.leaseTtl());
        return new ManagedPool(tenantId, pool, store);
    }
}
