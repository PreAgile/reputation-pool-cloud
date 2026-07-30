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
 * <p><b>Bounded memory, and why nothing is evicted.</b> Buckets are keyed by tenant, and tenants are
 * finite: a key must exist in the database to authenticate, so only paying customers can create an entry.
 * That is the difference from a per-IP limiter, where anyone on the internet mints keys and eviction is
 * mandatory. Here the map's ceiling is the customer count, which we control. One entry costs roughly 90
 * bytes (header, {@code double}, {@code Instant}, map node), so even 100k tenants is under 10MB.
 *
 * <p>An earlier version swept buckets that were at capacity — such a bucket is indistinguishable from a
 * fresh one, so forgetting it changes no decision. The reasoning was sound; the mechanism was not, and it
 * cost more than the memory it saved:
 *
 * <ul>
 *   <li><b>The sweep could not make progress under the load that triggered it.</b> It ran once the map
 *       passed a threshold and removed only full buckets — but a map that large means heavy traffic,
 *       which means buckets are drained, not full. With nothing to remove the size stayed above the
 *       threshold, so <em>every subsequent call</em> walked the whole map on the request thread, taking
 *       one monitor per entry. The component that sheds load became the load. No hysteresis, no floor.
 *   <li><b>Eviction raced with consumption.</b> A caller that obtained a bucket from {@code
 *       computeIfAbsent} but had not yet entered its monitor could have that bucket removed underneath
 *       it; it then spent a token on an orphan nobody could see, and its next call was handed a fresh
 *       full bucket. The tenant gained up to {@code burst} extra calls. No lock fixes this — the
 *       reference had already escaped.
 * </ul>
 *
 * <p>Both faults belonged to the eviction, not to the limiter, so the eviction is gone. If the tenant
 * count ever needs watching, {@link #trackedTenantCount()} is the seam to expose as a gauge — a number
 * on a dashboard beats a scan on the hot path.
 */
public final class RateLimiter {

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
     * Consumes one token for {@code tenantId} and reports whether the call may proceed. <b>This is not a
     * query.</b> An allowed call leaves the bucket one token lighter, so calling it twice costs two. A
     * denied call consumes nothing and returns the wait until the next token accrues, so the caller can
     * send a {@code Retry-After} hint instead of an unqualified rejection.
     *
     * <p><b>Why {@code tryConsume} and not {@code check}.</b> The name has to carry the side effect. Read
     * {@code limiter.check(id);} with the result discarded — as the tests legitimately do to drain a
     * bucket — and nothing tells you a token was spent; it reads as a no-op. {@code tryAcquire}, the
     * Guava spelling, is deliberately avoided: {@code acquire} is this product's own domain verb for
     * taking a resource lease, so {@code limiter.tryAcquire(...)} would read as that instead.
     *
     * <p>Disabled configuration always allows and records nothing — the escape hatch stays cheap.
     */
    public Decision tryConsume(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        if (!properties.enabled()) {
            return Decision.allow();
        }
        Instant now = clock.instant();
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

    /** Tracked bucket count — package-private for tests, and the seam to expose as a gauge if needed. */
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
