package io.github.preagile.reputationpool.cloud.tenant;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
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
 * <p><b>Delete ordering.</b> Delete evicts the in-memory pool <em>first</em> ({@link
 * TenantPoolRegistry#evict}) so no further data-plane traffic can be routed to the tenant, and only then
 * hard-deletes its durable rows and tombstones the tenant row ({@link
 * TenantRepository#deleteTenantData}, one transaction). Memory-first is the safer order: the worst
 * interruption leaves "rows still in the DB but serving stopped" (recoverable by retrying the delete),
 * never "serving from memory but the rows are gone".
 *
 * <p><b>Scope note.</b> Reclaiming the shared {@code GlobalResourceBudget} counters on delete (#84) is a
 * follow-up: that bean is not wired here yet, and a delete without it merely leaves the budget counting
 * resources that are gone — conservative (it can only refuse sooner), never unsafe. Tracked for after
 * #84 lands on main.
 */
public final class TenantLifecycleService {

    private final TenantRepository tenants;
    private final TenantPoolRegistry registry;

    public TenantLifecycleService(TenantRepository tenants, TenantPoolRegistry registry) {
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
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
     * Deletes a tenant: evicts its in-memory pool, hard-deletes every scoped row, and tombstones the
     * tenant row to {@code DELETED}. Idempotent — deleting an already-deleted tenant is a no-op.
     */
    public void delete(String id) {
        TenantStatus current = statusOf(id);
        if (current == TenantStatus.DELETED) {
            return;
        }
        if (!current.canTransitionTo(TenantStatus.DELETED)) {
            throw illegalTransition(current, TenantStatus.DELETED);
        }
        // Memory first (stop routing), then the durable cascade + tombstone in one transaction.
        registry.evict(id);
        tenants.deleteTenantData(id);
    }

    private void transition(String id, TenantStatus next) {
        TenantStatus current = statusOf(id);
        if (current == next) {
            return; // already there — idempotent no-op
        }
        if (!current.canTransitionTo(next)) {
            throw illegalTransition(current, next);
        }
        tenants.updateStatus(id, next);
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
}
