package io.github.preagile.reputationpool.cloud.tenant;

import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Drives a tenant through its lifecycle (issue #83): suspend, reactivate, and delete. It is the one
 * place the {@link TenantStatus} state machine is enforced and the one place a delete's side effects are
 * orchestrated, so the control plane just calls a verb and never has to know the cascade.
 *
 * <p><b>Transitions.</b> Every verb reads the current status and refuses an illegal edge (per
 * {@link TenantStatus#canTransitionTo}) with {@code 409 Conflict}; an unknown tenant is {@code 404}. A
 * verb that would land on the state the tenant is already in is a no-op (idempotent), so a retried
 * suspend/reactivate/delete is safe.
 *
 * <p><b>Compare-and-set against races.</b> The read (current status) and the write (status update or
 * delete cascade) are not one atomic operation, so a concurrent lifecycle call on the same tenant could
 * otherwise race in between — most dangerously, a delete's terminal {@code DELETED} tombstone getting
 * silently reverted by a suspend/reactivate that read the pre-delete status first. Every write goes
 * through {@link TenantRepository}'s compare-and-set contract (guard the expected prior status); on a
 * lost race this re-reads the actual current status and either treats it as an idempotent no-op (a
 * concurrent call already reached the same target) or rejects with {@code 409} so the caller re-reads and
 * retries, rather than either silently overwriting or blindly retrying forever.
 *
 * <p><b>Delete ordering.</b> Delete captures the pool's resource/cell counts, evicts the in-memory pool
 * <em>first</em> ({@link TenantPoolRegistry#evict}) so no further data-plane traffic can be routed to the
 * tenant, hard-deletes its durable rows and tombstones the tenant row ({@link
 * TenantRepository#deleteTenantData}, one transaction, CAS-guarded), and only then releases those counts
 * back to the shared {@link GlobalResourceBudget} — releasing only after the delete actually committed,
 * so a lost race (another call already deleted it) never double-releases. Memory-first is the safer
 * order: the worst interruption leaves "rows still in the DB but serving stopped" (recoverable by
 * retrying the delete), never "serving from memory but the rows are gone".
 */
public final class TenantLifecycleService {

    private final TenantRepository tenants;
    private final TenantPoolRegistry registry;
    private final GlobalResourceBudget budget;

    public TenantLifecycleService(TenantRepository tenants, TenantPoolRegistry registry, GlobalResourceBudget budget) {
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.budget = Objects.requireNonNull(budget, "budget must not be null");
    }

    /** Freezes a tenant: its data is kept but its API keys stop resolving (data-plane access denied). */
    public void suspend(String id) {
        transition(id, TenantStatus.SUSPENDED);
    }

    /** Un-freezes a suspended tenant back to active, restoring access. */
    public void reactivate(String id) {
        transition(id, TenantStatus.ACTIVE);
    }

    /**
     * Deletes a tenant: evicts its in-memory pool, hard-deletes every scoped row, tombstones the tenant
     * row to {@code DELETED}, and releases its resource/cell usage back to the shared budget. Idempotent
     * — deleting an already-deleted tenant is a no-op.
     */
    public void delete(String id) {
        TenantStatus current = statusOf(id);
        if (current == TenantStatus.DELETED) {
            return;
        }
        if (!current.canTransitionTo(TenantStatus.DELETED)) {
            throw illegalTransition(current, TenantStatus.DELETED);
        }
        // Capture usage before evicting: once evicted, poolFor would build a fresh, empty pool.
        PoolSnapshot snapshot = registry.poolFor(id).snapshot();
        registry.evict(id);
        if (!tenants.deleteTenantData(id, current)) {
            TenantStatus now = statusOf(id);
            if (now == TenantStatus.DELETED) {
                return; // a concurrent delete already committed — idempotent, and it already released
            }
            throw concurrentModification();
        }
        budget.release(snapshot.registered().size(), snapshot.cells().size());
    }

    private void transition(String id, TenantStatus next) {
        TenantStatus current = statusOf(id);
        if (current == next) {
            return; // already there — idempotent no-op
        }
        if (!current.canTransitionTo(next)) {
            throw illegalTransition(current, next);
        }
        if (!tenants.compareAndSetStatus(id, current, next)) {
            TenantStatus now = statusOf(id);
            if (now == next) {
                return; // a concurrent call already reached the same target — idempotent
            }
            throw concurrentModification();
        }
    }

    private TenantStatus statusOf(String id) {
        return tenants.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found"))
                .status();
    }

    private static ResponseStatusException illegalTransition(TenantStatus from, TenantStatus to) {
        // Generic-enough reason: names a lifecycle rule, leaks nothing sensitive.
        return new ResponseStatusException(
                HttpStatus.CONFLICT, "illegal tenant transition: " + from.toDb() + " -> " + to.toDb());
    }

    /** A concurrent lifecycle call on the same tenant won the race; the caller should re-read and retry. */
    private static ResponseStatusException concurrentModification() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant was concurrently modified, retry");
    }
}
