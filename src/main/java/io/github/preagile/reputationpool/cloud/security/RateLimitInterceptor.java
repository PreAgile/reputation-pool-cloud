package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Enforces the per-tenant request ceiling on every gRPC call (issue #132), rejecting excess with {@link
 * Status#RESOURCE_EXHAUSTED} and a {@code retry-after} hint.
 *
 * <p><b>Runs after authentication.</b> The tenant is read from {@link TenantContext#TENANT_ID}, which
 * {@link ApiKeyAuthInterceptor} puts there — so this interceptor must be ordered behind it (see the
 * {@code @Order} constants in {@code GrpcSecurityConfiguration}). Limiting before authentication is not
 * possible: the caller is just an API key until someone resolves it to a tenant.
 *
 * <p><b>The limiter fails open, and says so.</b> {@code AGENTS.md} requires authentication, authorisation
 * and tenant boundaries to fail closed — this is none of those. It is capacity control, and a bug in the
 * limiter that rejects healthy traffic is worse than the burst it would have absorbed. So an unexpected
 * failure lets the call through. Silence would be the real hazard, so every such pass increments {@link
 * #ERRORS_COUNTER} and logs at ERROR: "we stopped limiting" must be visible, not inferred.
 *
 * <p><b>Why {@code RESOURCE_EXHAUSTED}.</b> It is the gRPC equivalent of HTTP 429 and is classified as
 * retryable, which is the behaviour we want — unlike {@code UNAVAILABLE}, it does not suggest the server
 * is down. The wait is attached as {@code retry-after} metadata (seconds); gRPC has no standard header
 * for this, and the name mirrors HTTP so a REST gateway (#147) can forward the same value.
 *
 * <p><b>Note for {@code acquire} (#148).</b> That RPC is contractually fail-open on the client side: an
 * SDK must treat rejection — including this one — as "no advice available", never as an exception. A
 * limiter that stops a customer's scraper would defeat the reason {@code acquire} is fail-open at all.
 */
public final class RateLimitInterceptor implements ServerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(RateLimitInterceptor.class);

    /** Calls rejected for exceeding the tenant ceiling — the signal an alert rule watches. */
    private static final String LIMITED_COUNTER = "datapane.rate.limited";

    /**
     * Calls admitted because the limiter itself failed. Non-zero means the ceiling is not being enforced,
     * which is a different (and quieter) problem than being over it.
     */
    private static final String ERRORS_COUNTER = "datapane.rate.limiter.errors";

    /** Seconds the caller should wait before retrying. Mirrors the HTTP header name deliberately. */
    static final Metadata.Key<String> RETRY_AFTER = Metadata.Key.of("retry-after", Metadata.ASCII_STRING_MARSHALLER);

    private final RateLimiter limiter;
    private final Counter limited;
    private final Counter errors;

    public RateLimitInterceptor(RateLimiter limiter, MeterRegistry meterRegistry) {
        this.limiter = Objects.requireNonNull(limiter, "limiter must not be null");
        Objects.requireNonNull(meterRegistry, "meterRegistry must not be null");
        // Pre-register so both series exist at 0 from the first scrape. An absent series and a series at 0
        // mean different things to an alert rule (see MetricsEventSink for the same reasoning).
        this.limited = meterRegistry.counter(LIMITED_COUNTER);
        this.errors = meterRegistry.counter(ERRORS_COUNTER);
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        if (!limiter.enabled()) {
            return next.startCall(call, headers);
        }
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null) {
            // No tenant in context means authentication has not run (or has already rejected the call).
            // Inventing a key here — a shared "anonymous" bucket, say — would let one unauthenticated
            // caller throttle every other, so let it pass and leave the decision to the auth interceptor.
            return next.startCall(call, headers);
        }

        RateLimiter.Decision decision;
        try {
            decision = limiter.check(tenantId);
        } catch (RuntimeException e) {
            errors.increment();
            log.error("rate limiter failed; allowing call through (tenant={})", tenantId, e);
            return next.startCall(call, headers);
        }

        if (decision.allowed()) {
            return next.startCall(call, headers);
        }

        limited.increment();
        // DEBUG, not WARN: being over the ceiling is the limiter working as designed, and a tenant in a
        // hot loop would otherwise flood the log with the very traffic we are rejecting. The counter and
        // its alert rule are how this becomes visible.
        log.debug("rate limit exceeded (tenant={}, retryAfter={}s)", tenantId, decision.retryAfterSeconds());

        Metadata trailers = new Metadata();
        trailers.put(RETRY_AFTER, Long.toString(decision.retryAfterSeconds()));
        call.close(
                Status.RESOURCE_EXHAUSTED.withDescription(
                        "rate limit exceeded; retry after " + decision.retryAfterSeconds() + "s"),
                trailers);
        return new ServerCall.Listener<>() {};
    }
}
