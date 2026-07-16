package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import java.util.Objects;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Authenticates every gRPC call by the {@code x-api-key} metadata header and attaches the resolved
 * tenant to the gRPC {@link Context}. The key's SHA-256 digest is looked up via {@link TenantResolver}:
 * an active key yields its tenant (attached as {@link TenantContext#TENANT_ID}); anything else closes
 * the call with {@code UNAUTHENTICATED} (fail closed). A missing key, an unknown key, and a revoked key
 * are indistinguishable to the caller — the response never reveals whether a key exists.
 *
 * <p>Hashing before lookup means the raw key is never compared or stored; the key is a high-entropy
 * token, so the digest is a sufficient one-way transform (see {@link ApiKeyHashing}). A resolver
 * failure (e.g. the database is down) closes the call with {@code UNAVAILABLE} rather than a false
 * {@code UNAUTHENTICATED}, so an outage stays diagnosable and retryable instead of masquerading as bad
 * credentials.
 */
public class ApiKeyAuthInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> API_KEY = Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER);

    private static final Logger log = LoggerFactory.getLogger(ApiKeyAuthInterceptor.class);

    private final TenantResolver tenantResolver;

    public ApiKeyAuthInterceptor(TenantResolver tenantResolver) {
        this.tenantResolver = Objects.requireNonNull(tenantResolver, "tenantResolver must not be null");
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        String provided = headers.get(API_KEY);
        if (provided == null || provided.isBlank()) {
            return deny(call, Status.UNAUTHENTICATED.withDescription("missing or invalid API key"));
        }
        Optional<String> tenantId;
        try {
            tenantId = tenantResolver.resolveByKeyHash(ApiKeyHashing.sha256(provided));
        } catch (RuntimeException e) {
            log.error("tenant resolution failed", e);
            return deny(call, Status.UNAVAILABLE.withDescription("authentication temporarily unavailable"));
        }
        if (tenantId.isEmpty()) {
            return deny(call, Status.UNAUTHENTICATED.withDescription("missing or invalid API key"));
        }
        Context context = Context.current().withValue(TenantContext.TENANT_ID, tenantId.get());
        return Contexts.interceptCall(context, call, headers, next);
    }

    private static <ReqT, RespT> ServerCall.Listener<ReqT> deny(ServerCall<ReqT, RespT> call, Status status) {
        call.close(status, new Metadata());
        return new ServerCall.Listener<>() {};
    }
}
