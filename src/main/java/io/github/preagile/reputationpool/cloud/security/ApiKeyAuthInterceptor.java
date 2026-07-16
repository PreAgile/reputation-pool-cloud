package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Rejects every gRPC call that does not carry a valid API key in the {@code x-api-key} metadata header,
 * closing it with {@code UNAUTHENTICATED} (fail closed). On success it attaches the tenant to the gRPC
 * {@link Context} via {@link TenantContext} — Phase 1 (issue #4) always the single
 * {@link TenantContext#DEFAULT_TENANT}; issue #9 will resolve the real tenant from the key.
 *
 * <p>The comparison is constant-time over SHA-256 digests of the provided and expected keys, so a
 * timing side channel cannot leak the key and unequal lengths do not short-circuit. A blank configured
 * key means "not configured" — the interceptor then rejects all calls rather than accepting anything.
 */
public class ApiKeyAuthInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> API_KEY = Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER);

    private static final Logger log = LoggerFactory.getLogger(ApiKeyAuthInterceptor.class);

    // The SHA-256 of the expected key, or null when no key is configured (then everything is rejected).
    private final byte[] expectedHash;

    public ApiKeyAuthInterceptor(String expectedApiKey) {
        this.expectedHash = (expectedApiKey == null || expectedApiKey.isBlank()) ? null : sha256(expectedApiKey);
        if (this.expectedHash == null) {
            log.warn("no reputation-pool.auth.api-key configured — all gRPC calls will be rejected (fail closed)");
        }
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        if (!authorized(headers.get(API_KEY))) {
            call.close(Status.UNAUTHENTICATED.withDescription("missing or invalid API key"), new Metadata());
            return new ServerCall.Listener<>() {};
        }
        // Phase 1: one constant tenant. #9 resolves the real tenant from the API key here.
        Context context = Context.current().withValue(TenantContext.TENANT_ID, TenantContext.DEFAULT_TENANT);
        return Contexts.interceptCall(context, call, headers, next);
    }

    private boolean authorized(String provided) {
        if (expectedHash == null || provided == null || provided.isBlank()) {
            return false;
        }
        return MessageDigest.isEqual(expectedHash, sha256(provided));
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a required JDK algorithm; its absence is a broken runtime, not a normal error.
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
