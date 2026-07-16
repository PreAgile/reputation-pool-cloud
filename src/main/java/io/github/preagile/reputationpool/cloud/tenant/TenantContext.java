package io.github.preagile.reputationpool.cloud.tenant;

import io.grpc.Context;

/**
 * The seam where the authenticated tenant is carried from the auth interceptor to the gRPC handlers.
 * The interceptor resolves the tenant and attaches it to the gRPC {@link Context}; downstream code
 * reads {@link #TENANT_ID} from {@code Context.current()}.
 *
 * <p>Issue #4 attached a single constant tenant; issue #9 fills this seam from a real API-key → tenant
 * lookup (a {@code TenantResolver}). Issue #9b routes each call to the resolved tenant's pool
 * namespace; this seam does not change, only what fills it.
 */
public final class TenantContext {

    private TenantContext() {}

    /** The resolved tenant for the current call, set by the auth interceptor. */
    public static final Context.Key<String> TENANT_ID = Context.key("tenant-id");

    /** The tenant id the single env API key is seeded under until per-tenant key management (#11). */
    public static final String DEFAULT_TENANT = "default";
}
