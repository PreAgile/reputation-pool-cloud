package io.github.preagile.reputationpool.cloud.grpc;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import java.util.Objects;
import net.devh.boot.grpc.server.service.GrpcService;

/**
 * The Spring-registered gRPC service: a thin {@link GrpcService} adapter over the shared handler in the
 * published {@code reputation-pool-grpc} module. All six RPC handlers — decode, one pool call, encode —
 * live in the base class; cloud supplies only the framework registration and, for multi-tenancy, the
 * per-call pool routing.
 *
 * <p><b>Per-tenant routing (#9b, #29).</b> Instead of a single injected pool, cloud overrides the base's
 * {@code pool()} hook to resolve the pool for the tenant the auth interceptor put on the gRPC context
 * ({@link TenantContext#TENANT_ID}), and the {@code subscriptionPoolId()} hook so a {@code SubscribeEvents}
 * stream is scoped to that same tenant — now that emits fan out through {@code broadcaster.forPool(tenantId)}
 * (#29), a subscriber receives only its own tenant's events. Every decode/encode/error path in the base is
 * reused unchanged; the only cloud-specific behavior is which tenant a call acts on and which tenant's
 * stream a subscription joins.
 */
@GrpcService
public class ReputationAdvisorService extends io.github.preagile.reputationpool.grpc.ReputationAdvisorService {

    private final TenantPoolRegistry registry;

    public ReputationAdvisorService(TenantPoolRegistry registry, EventBroadcaster broadcaster) {
        super(broadcaster);
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
    }

    /**
     * Routes the call to the authenticated tenant's pool. The auth interceptor admits a call only after
     * resolving its API key to a tenant, so a served call always carries a tenant; a missing one is a
     * wiring fault, surfaced as a runtime error (the base maps it to {@code INTERNAL}) rather than
     * silently acting on some other tenant's pool.
     */
    @Override
    protected ResourcePool pool() {
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalStateException("no authenticated tenant on the gRPC context");
        }
        return registry.poolFor(tenantId);
    }

    /**
     * Scopes a {@code SubscribeEvents} stream to the authenticated tenant's pool, so the base subscribes
     * the observer under that tenant and it receives only that tenant's events (paired with the emit-side
     * {@code broadcaster.forPool(tenantId)} wiring, #29). Same guard as {@link #pool()}: a served call
     * always carries a tenant, so a missing one is a wiring fault surfaced as a runtime error rather than
     * silently joining some other tenant's — or the default — stream.
     */
    @Override
    protected String subscriptionPoolId() {
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalStateException("no authenticated tenant on the gRPC context");
        }
        return tenantId;
    }
}
