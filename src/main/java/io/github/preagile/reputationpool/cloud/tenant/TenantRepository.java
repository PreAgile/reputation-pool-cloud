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
}
