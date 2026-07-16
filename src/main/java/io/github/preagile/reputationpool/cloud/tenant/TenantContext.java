package io.github.preagile.reputationpool.cloud.tenant;

import io.grpc.Context;

/**
 * The seam where the authenticated tenant is carried from the auth interceptor to the gRPC handlers.
 * The interceptor resolves the tenant and attaches it to the gRPC {@link Context}; downstream code
 * reads {@link #TENANT_ID} from {@code Context.current()}.
 *
 * <p>Phase 1 (issue #4) uses a single constant tenant — the interceptor authenticates one API key and
 * attaches {@link #DEFAULT_TENANT}. Issue #9 replaces that with a real API-key → tenant lookup and
 * routes each call to the tenant's pool namespace; this seam does not change, only what fills it.
 */
public final class TenantContext {

    private TenantContext() {}

    /** The resolved tenant for the current call, set by the auth interceptor. */
    public static final Context.Key<String> TENANT_ID = Context.key("tenant-id");

    /** The single tenant used until #9 introduces real multi-tenancy. */
    public static final String DEFAULT_TENANT = "default";
}
