package io.github.preagile.reputationpool.cloud.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory, {@link Clock}-driven token bucket per tenant (issue #132). Decides, per call, whether a
 * tenant may proceed; tokens refill at {@link RateLimitProperties#requestsPerSecond} and cap at {@link
 * RateLimitProperties#burst}.
 *
 * <p>This type is pure decision logic — it emits no logs or metrics. Observability is the caller's job
 * (see {@link RateLimitInterceptor}), which owns the request context. Same split as {@link
 * LoginThrottle}.
 *
 * <p><b>Single-instance assumption.</b> State lives in this JVM's heap. If the stack is ever scaled to
 * more than one app instance, each gets its own buckets and the effective ceiling multiplies by the
 * instance count — the limiter does not fail, it silently loosens. That is acceptable today (one
 * instance, by design) but must be revisited with issue #85, which owns the multi-instance state model.
 * A shared store (Redis) is the usual answer and is deliberately not taken on now: it would add a
 * runtime dependency to guard a ceiling nobody has measured yet.
 *
 * <p><b>Bounded memory.</b> Buckets are keyed by tenant, and tenants are finite (a key must exist in the
 * database to authenticate), so this map cannot grow the way a per-IP map can. Full buckets are still
 * swept opportunistically: a bucket at capacity carries no information — recreating it yields the same
 * state — so idle tenants leave nothing behind.
 */
public final class RateLimiter {

    /**
     * Above this many tracked tenants the sweep runs on every check rather than opportunistically. Not a
     * cap: it is a threshold at which "cheap and occasional" stops being cheap. Far above any plausible
     * tenant count, so in practice the sweep stays rare.
     */
    private static final int SWEEP_EAGERLY_ABOVE = 10_000;

    private final RateLimitProperties properties;
    private final Clock clock;

    /** Per-tenant bucket. Guarded by synchronizing on the value itself, like {@code LoginThrottle}. */
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimiter(RateLimitProperties properties, Clock clock) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public boolean enabled() {
        return properties.enabled();
    }

    /**
     * Whether {@code tenantId} may make one more call right now. Consumes a token when it can; when it
     * cannot, returns the wait until the next token accrues so the caller can send a {@code Retry-After}
     * hint instead of an unqualified rejection.
     *
     * <p>Disabled configuration always allows and records nothing — the escape hatch stays cheap.
     */
    public Decision check(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        if (!properties.enabled()) {
            return Decision.allow();
        }
        Instant now = clock.instant();
        if (buckets.size() > SWEEP_EAGERLY_ABOVE) {
            sweepFull(now);
        }
        Bucket bucket = buckets.computeIfAbsent(tenantId, key -> new Bucket(properties.burst(), now));
        synchronized (bucket) {
            refill(bucket, now);
            if (bucket.tokens >= 1.0d) {
                bucket.tokens -= 1.0d;
                return Decision.allow();
            }
            return Decision.deny(retryAfterSeconds(bucket.tokens));
        }
    }

    /** Adds the tokens accrued since the last touch, capped at burst. Caller holds the bucket's monitor. */
    private void refill(Bucket bucket, Instant now) {
        long elapsedNanos = Duration.between(bucket.lastRefill, now).toNanos();
        if (elapsedNanos <= 0) {
            // A clock that did not advance (or went backwards) must not mint tokens. Leave the bucket as
            // is rather than trusting the delta — with a fixed test clock this is the normal case.
            return;
        }
        double accrued = (elapsedNanos / 1_000_000_000.0d) * properties.requestsPerSecond();
        bucket.tokens = Math.min(properties.burst(), bucket.tokens + accrued);
        bucket.lastRefill = now;
    }

    /**
     * Seconds until the bucket holds a whole token, rounded up and floored at 1. Never returns 0 — a
     * {@code Retry-After: 0} tells a rejected caller to retry immediately, which is how a limiter turns
     * into a tight retry loop.
     */
    private long retryAfterSeconds(double tokens) {
        double missing = 1.0d - tokens;
        double seconds = missing / properties.requestsPerSecond();
        return Math.max(1L, (long) Math.ceil(seconds));
    }

    /**
     * Drops buckets that are at capacity: such a bucket is indistinguishable from a fresh one, so
     * forgetting it changes no decision. Only touches buckets it can lock without waiting — a bucket in
     * use is by definition not idle.
     */
    private void sweepFull(Instant now) {
        buckets.forEach((tenantId, bucket) -> {
            synchronized (bucket) {
                refill(bucket, now);
                if (bucket.tokens >= properties.burst()) {
                    buckets.remove(tenantId, bucket);
                }
            }
        });
    }

    /** Tracked bucket count — package-private so tests can assert idle tenants are swept. */
    int trackedTenantCount() {
        return buckets.size();
    }

    /** The verdict for one call: allowed, or denied with a {@code Retry-After} hint in seconds. */
    public record Decision(boolean allowed, long retryAfterSeconds) {
        static Decision allow() {
            return new Decision(true, 0L);
        }

        static Decision deny(long retryAfterSeconds) {
            return new Decision(false, retryAfterSeconds);
        }
    }

    /** Mutable per-tenant bucket; every access synchronizes on the instance. */
    private static final class Bucket {
        private double tokens;
        private Instant lastRefill;

        private Bucket(int initialTokens, Instant now) {
            this.tokens = initialTokens;
            this.lastRefill = now;
        }
    }
}
