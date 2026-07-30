package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.grpc.ForwardingServerCallListener;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Enforces {@link StreamSubscriptionQuota} on server-streaming calls (issue #132 follow-up), rejecting a
 * tenant's excess subscriptions with {@link Status#RESOURCE_EXHAUSTED}.
 *
 * <p><b>Why an interceptor and not a service override.</b> Counting open streams needs both ends: +1 when
 * the stream opens and −1 when it ends, on every termination path. The obvious place for the second half
 * would be {@code ServerCallStreamObserver#setOnCancelHandler} in an overridden {@code subscribeEvents},
 * but upstream already owns that slot — {@code EventBroadcaster.subscribe} installs {@code
 * setOnCancelHandler(() -> subscribers.remove(subscriber))}, and the setter holds one handler, so
 * registering ours would delete upstream's own cleanup and leak the subscriber it was meant to remove.
 * A {@link ServerCall.Listener} is a separate mechanism that cannot collide with it, so the count is kept
 * here instead. It also puts the ceiling next to the request-rate ceiling, which is where a reader looks.
 *
 * <p><b>Only server-streaming calls are counted.</b> The five unary RPCs are already metered exactly by
 * the token bucket — one call, one token — so counting them here would double-charge and, worse, never
 * release (a unary call's "stream" is over before anyone could care). {@code
 * MethodDescriptor#getType()} is the discriminator, so this stays correct if another streaming RPC is
 * added later.
 *
 * <p><b>Runs after authentication</b>, for the same reason {@link RateLimitInterceptor} does: the tenant
 * comes from {@link TenantContext#TENANT_ID}, which the auth interceptor puts there. Ordering is pinned in
 * {@code GrpcSecurityConfiguration}.
 *
 * <p><b>Fails open, and says so.</b> This is capacity control, not an auth boundary: a bug here that
 * refuses healthy subscriptions is worse than the streams it would have shed. An unexpected failure admits
 * the call and increments {@link #ERRORS_COUNTER} at ERROR level, because "we stopped counting" must be
 * visible rather than inferred — same posture and same wording as the rate limiter.
 *
 * <p><b>No {@code retry-after} on rejection.</b> Unlike the rate limiter, waiting does not help: a slot
 * frees when some other stream of the same tenant ends, which is not a duration anyone can predict.
 * Inventing a number would be a lie, so the rejection carries only a description saying what to do —
 * close a stream.
 */
public final class StreamQuotaInterceptor implements ServerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StreamQuotaInterceptor.class);

    /**
     * Subscriptions refused for exceeding the tenant's concurrent-stream ceiling. Separate from {@code
     * datapane.rate.limited} on purpose: both surface as {@code RESOURCE_EXHAUSTED} on the wire, so
     * without its own series an operator cannot tell "too many requests" from "too many open streams",
     * and the two have completely different fixes.
     */
    private static final String REJECTED_COUNTER = "datapane.stream.subscriptions.rejected";

    /** Streams admitted because the quota itself failed. Non-zero means the ceiling is not being enforced. */
    private static final String ERRORS_COUNTER = "datapane.stream.quota.errors";

    private final StreamSubscriptionQuota quota;
    private final Counter rejected;
    private final Counter errors;

    public StreamQuotaInterceptor(StreamSubscriptionQuota quota, MeterRegistry meterRegistry) {
        this.quota = Objects.requireNonNull(quota, "quota must not be null");
        Objects.requireNonNull(meterRegistry, "meterRegistry must not be null");
        // Pre-register so both series exist at 0 from the first scrape — an absent series and a series at
        // 0 mean different things to an alert rule (see MetricsEventSink for the same reasoning).
        this.rejected = meterRegistry.counter(REJECTED_COUNTER);
        this.errors = meterRegistry.counter(ERRORS_COUNTER);
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        if (call.getMethodDescriptor().getType() != MethodDescriptor.MethodType.SERVER_STREAMING) {
            return next.startCall(call, headers);
        }
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null) {
            // No tenant means authentication has not run (or has already rejected the call). Inventing a
            // shared key here would let one unauthenticated caller exhaust everyone's slots, so let it
            // pass and leave the decision to the auth interceptor — same call as the rate limiter makes.
            return next.startCall(call, headers);
        }

        boolean admitted;
        try {
            admitted = quota.tryOpen(tenantId);
        } catch (RuntimeException e) {
            errors.increment();
            log.error("stream quota failed; allowing subscription through (tenant={})", tenantId, e);
            return next.startCall(call, headers);
        }

        if (!admitted) {
            rejected.increment();
            // DEBUG, not WARN: being at the ceiling is the quota working as designed, and a client in a
            // reconnect loop would otherwise flood the log with the very traffic being refused. The
            // counter and its alert rule are how this becomes visible.
            log.debug("stream quota exceeded (tenant={})", tenantId);
            call.close(
                    Status.RESOURCE_EXHAUSTED.withDescription(
                            "too many concurrent event subscriptions; close one before opening another"),
                    new Metadata());
            return new ServerCall.Listener<>() {};
        }

        // From here the slot is claimed and must be returned exactly once. `startCall` running the
        // handler can throw, and gRPC would then never deliver a termination callback, so release on that
        // path too — otherwise a handler failure would permanently consume one of the tenant's slots.
        AtomicBoolean releasedOnce = new AtomicBoolean();
        Runnable release = () -> {
            if (releasedOnce.compareAndSet(false, true)) {
                quota.close(tenantId);
            }
        };

        ServerCall.Listener<ReqT> delegate;
        try {
            delegate = next.startCall(call, headers);
        } catch (RuntimeException e) {
            release.run();
            throw e;
        }

        // gRPC ends a call through exactly one of these, but guarding with `releasedOnce` keeps a double
        // callback (or a future runtime that fires both) from returning the slot twice.
        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(delegate) {
            @Override
            public void onCancel() {
                try {
                    super.onCancel();
                } finally {
                    release.run();
                }
            }

            @Override
            public void onComplete() {
                try {
                    super.onComplete();
                } finally {
                    release.run();
                }
            }
        };
    }
}
