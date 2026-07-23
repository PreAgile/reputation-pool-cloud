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

    /** Sets a tenant's lifecycle status (suspend/reactivate). No-op if the id is unknown. */
    void updateStatus(String id, TenantStatus status);

    /**
     * Hard-deletes every row scoped to {@code id} — the cloud-owned tables ({@code api_key},
     * {@code usage_meter}, {@code score_sample}) and the upstream pool tables (keyed by
     * {@code pool_id = id}) — and leaves the {@code tenant} row as a {@code DELETED} tombstone, all in
     * one transaction. Either the whole cascade commits or none of it does (no partial deletion), so a
     * failure mid-way rolls back rather than stranding a half-deleted tenant.
     */
    void deleteTenantData(String id);
}
