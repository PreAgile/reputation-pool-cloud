package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.core.pool.ResourcePool;
import java.util.Objects;

/**
 * Interim {@link TenantPoolRegistry} that routes every tenant to the one shared {@link ResourcePool},
 * so the control plane (#11) can build against the registry contract before per-tenant isolation
 * (#9b) lands. It does not isolate state — every tenant sees the same pool — so it is correct only
 * while cloud runs a single tenant. #9b replaces this bean with the real per-tenant implementation.
 */
public final class SinglePoolTenantRegistry implements TenantPoolRegistry {

    private final ResourcePool pool;

    public SinglePoolTenantRegistry(ResourcePool pool) {
        this.pool = Objects.requireNonNull(pool, "pool must not be null");
    }

    @Override
    public ResourcePool poolFor(String tenantId) {
        return pool;
    }

    @Override
    public void onboard(String tenantId) {
        // No-op: the single shared pool already serves every tenant. #9b makes this create a pool.
    }
}
