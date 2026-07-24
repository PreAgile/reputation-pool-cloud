package io.github.preagile.reputationpool.cloud.tenant;

import java.util.List;
import java.util.Optional;

/**
 * Read/write access to the {@code tenant} table — the shared seam both the control plane (#11, which
 * creates and lists tenants) and per-tenant pool routing (#9b, which enumerates them to build the pool
 * registry) depend on. Kept as an interface so the two tracks code against the contract, not the JDBC
 * implementation.
 */
public interface TenantRepository {

    /** Persists a new tenant. Fails if a tenant with the same id already exists. */
    void create(Tenant tenant);

    /** All tenants, oldest first. */
    List<Tenant> findAll();

    Optional<Tenant> findById(String id);

    /**
     * Sets a tenant's lifecycle status (suspend/reactivate), but only if its current status still
     * equals {@code expected} — a compare-and-set guard (issue #83) so a lifecycle call that read a
     * stale status can never blindly overwrite a state a concurrent call already moved past (most
     * importantly, a {@code DELETED} tombstone must never be silently reverted by a racing
     * suspend/reactivate). No-op (and returns {@code false}) if the id is unknown.
     *
     * @return {@code true} if the row's status matched {@code expected} and was updated to {@code next};
     *     {@code false} if it did not match (lost the race) — the caller must re-read and decide
     */
    boolean compareAndSetStatus(String id, TenantStatus expected, TenantStatus next);

    /**
     * Hard-deletes every row scoped to {@code id} — the cloud-owned tables ({@code api_key},
     * {@code usage_meter}, {@code score_sample}) and the upstream pool tables (keyed by
     * {@code pool_id = id}) — and tombstones the {@code tenant} row to {@code DELETED}, all in one
     * transaction, but only if the tenant's status still equals {@code expectedCurrentStatus} at the
     * moment of the tombstone write (issue #83's compare-and-set guard, the same reasoning as {@link
     * #compareAndSetStatus}). If it does not match — a concurrent suspend/reactivate/delete raced this
     * call — the entire transaction rolls back (no partial deletion) and this returns {@code false} so
     * the caller can re-read and decide, rather than silently deleting data under a status the caller
     * never actually observed.
     *
     * @return {@code true} if the cascade + tombstone committed; {@code false} if it rolled back because
     *     the status had already changed
     */
    boolean deleteTenantData(String id, TenantStatus expectedCurrentStatus);
}
