package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The incremental counter behind the shared-JVM global resource budget (issue #84). Every tenant's pool
 * lives in this one process ({@link PerTenantPoolRegistry} — a {@code ConcurrentHashMap} of pools on the
 * same heap), so this component tracks how many registered resources and reputation cells exist
 * <em>in total, across every tenant</em>, and admits a new one only while that running total stays
 * under the configured ceiling.
 *
 * <p><b>Why a running total, not per-tenant quotas.</b> The requirement is that a single active tenant
 * may use 100% of the budget, while several tenants sharing the JVM must divide it dynamically.
 * Computing a per-tenant share would either cap a lone tenant below full capacity or force constantly
 * recomputing shares as tenants come and go. Checking only "does the grand total exceed the budget" gets
 * both properties for free, with no per-tenant bookkeeping at all: with one tenant the total <em>is</em>
 * that tenant's own usage, so it can grow all the way to the ceiling; as more tenants add usage, the
 * remaining headroom shrinks for everyone automatically. There is deliberately no per-tenant ceiling
 * field anywhere in this design (see {@link ReputationPoolProperties.Limits}).
 *
 * <p><b>Why incremental, not a snapshot sum.</b> Summing every tenant's {@code ResourcePool.snapshot()}
 * on every call would cost O(tenant count) on the hot path. Instead this holds two {@link AtomicLong}
 * counters that the gRPC seam ({@code cloud.grpc.ReputationAdvisorService}) increments only when it has
 * already determined — by checking that one tenant's own pool snapshot — that a call is about to create
 * a genuinely new resource or cell, not re-touch an existing one.
 *
 * <p><b>Monotonic by design.</b> {@code core.pool.ResourcePool} has no operation that removes a
 * registered resource or a reputation cell (register/report/acquire/renew/release/block* only add or
 * mutate existing state — verified against the 0.5.0 source), so these counters only ever go up for the
 * process's lifetime. Reclaiming budget when a tenant is deleted entirely is out of scope here (a
 * separate concern, alongside issue #83).
 *
 * <p><b>Fail-safe, not fail-closed.</b> This is an availability guard against one tenant starving the
 * shared heap, not an auth boundary: {@link #tryReserveResource()}/{@link #tryReserveCell()} let normal
 * traffic through unconditionally until the ceiling is actually reached, and only the excess is refused.
 * Reservation is one atomic compare-and-set loop, so two threads racing for the last unit of budget can
 * never both succeed.
 */
public final class GlobalResourceBudget {

    private final long maxResources;
    private final long maxCells;
    private final AtomicLong resourceCount = new AtomicLong();
    private final AtomicLong cellCount = new AtomicLong();

    public GlobalResourceBudget(ReputationPoolProperties.Limits limits) {
        Objects.requireNonNull(limits, "limits must not be null");
        this.maxResources = limits.maxResources();
        this.maxCells = limits.maxCells();
    }

    /**
     * Reserves one unit of the global budget for a resource about to be newly registered somewhere in
     * the JVM. Callers must first establish that the resource is actually new (e.g. absent from the
     * tenant's own {@code PoolSnapshot#registered()}) — re-registering an already-known resource must
     * not call this, or the counter would drift above the real total.
     *
     * @return {@code true} if the reservation fit under {@link ReputationPoolProperties.Limits#maxResources()}
     *     (the counter was incremented); {@code false} if the budget is already exhausted (nothing changed)
     */
    public boolean tryReserveResource() {
        return tryReserve(resourceCount, maxResources);
    }

    /**
     * Reserves one unit of the global budget for a reputation cell about to be newly created somewhere
     * in the JVM. Callers must first establish the cell is actually new (e.g. its {@code CellKey} absent
     * from the tenant's own {@code PoolSnapshot#cells()}) for the same reason as {@link
     * #tryReserveResource()}.
     *
     * @return {@code true} if the reservation fit under {@link ReputationPoolProperties.Limits#maxCells()}
     *     (the counter was incremented); {@code false} if the budget is already exhausted (nothing changed)
     */
    public boolean tryReserveCell() {
        return tryReserve(cellCount, maxCells);
    }

    /** The current global registered-resource count, summed across every tenant. For tests/observability. */
    public long resourceCount() {
        return resourceCount.get();
    }

    /** The current global reputation-cell count, summed across every tenant. For tests/observability. */
    public long cellCount() {
        return cellCount.get();
    }

    /** Atomically admits one more unit under {@code max}, or refuses without side effects if already at it. */
    private static boolean tryReserve(AtomicLong counter, long max) {
        long current;
        do {
            current = counter.get();
            if (current >= max) {
                return false;
            }
        } while (!counter.compareAndSet(current, current + 1));
        return true;
    }
}
