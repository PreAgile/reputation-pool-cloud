package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.core.pool.ResourcePool;

/**
 * Resolves the {@link ResourcePool} that serves a given tenant — the seam between the auth-resolved
 * tenant (carried on the gRPC context) and the engine. It exists so the control plane (#11) and
 * per-tenant isolation (#9b) can be built in parallel against one contract:
 *
 * <ul>
 *   <li>#11 calls {@link #onboard(String)} when it creates a tenant and {@link #poolFor(String)} to
 *       read that tenant's live state for the dashboard.
 *   <li>#9b supplies the real implementation — one pool + one tenant-scoped store per tenant — while
 *       the interim {@link SinglePoolTenantRegistry} routes every tenant to the one shared pool.
 * </ul>
 */
public interface TenantPoolRegistry {

    /** The pool serving {@code tenantId}. Never null for a known/onboarded tenant. */
    ResourcePool poolFor(String tenantId);

    /** Ensures a pool exists for a tenant created at runtime. Idempotent. */
    void onboard(String tenantId);
}
