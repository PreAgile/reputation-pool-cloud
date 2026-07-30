package io.github.preagile.reputationpool.cloud.security;

import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * How many {@code SubscribeEvents} streams one tenant may hold open at once (issue #132 follow-up).
 *
 * <p><b>Why the token bucket does not already cover this.</b> {@link RateLimitInterceptor} runs once per
 * call, at call start — that is the gRPC interceptor contract. For the five unary RPCs the accounting is
 * exact: one call, one unit of work, one token. {@code SubscribeEvents} is the sixth, and it is declared
 * {@code returns (stream PoolEvent)}: one call opens a channel that stays open until the client cancels
 * or the server shuts down, and the base handler explicitly never completes it. So a tenant spends one
 * token and keeps a stream forever. At the shipped defaults ({@code burst=50}, {@code 10/s}) that is 50
 * streams instantly and 36,000 after an hour, all for 36,050 tokens' worth of "requests".
 *
 * <p><b>What is already safe, and therefore not this class's job.</b> The upstream broadcaster gives each
 * subscriber a bounded 256-slot queue and evicts any subscriber that overflows it with {@code
 * RESOURCE_EXHAUSTED} (verified against {@code reputation-pool-grpc} 0.5.0, {@code EventBroadcaster}).
 * A slow consumer therefore cannot grow the heap without bound — the classic streaming failure is already
 * handled. What nothing counts is the <em>number</em> of subscribers, and that is what costs: each one is
 * a 256-slot queue held for the stream's lifetime, and every event fans out by walking the whole
 * subscriber list — so one tenant's stream hoard slows down tenants that have no subscriptions at all.
 *
 * <p><b>Why per-tenant and not a global total.</b> {@code GlobalResourceBudget} (issue #84) deliberately
 * uses a single running total so a lone tenant may use 100% of it. That reasoning does not transfer: the
 * threat here <em>is</em> one tenant opening many, and a global-only ceiling would let that tenant consume
 * it and lock everyone else out — the failure we are trying to prevent. A per-tenant ceiling also bounds
 * the total implicitly, because tenants are finite (a key must exist in the database to authenticate): the
 * worst case is {@code tenant count × maxConcurrentStreams}, which at realistic tenant counts is a few
 * thousand streams, not tens of thousands. If a hard global cap is ever wanted, {@code
 * EventBroadcaster.subscriberCount()} is the seam — it needs no state of ours and therefore cannot drift.
 *
 * <p><b>Nothing is ever evicted from this map.</b> Same reasoning as {@link RateLimiter}: tenants are
 * finite, an entry is a few dozen bytes, and eviction is what made the limiter's bucket sweep both slow
 * and racy. A counter that reaches zero simply stays at zero.
 *
 * <p><b>Availability guard, not an auth boundary.</b> {@code AGENTS.md} requires authentication,
 * authorisation and tenant boundaries to fail closed; this is none of those. Callers admit the stream when
 * this class misbehaves and make the failure loud instead (see {@link StreamQuotaInterceptor}).
 *
 * <p><b>Single-instance, like its siblings.</b> Counters live on this JVM's heap, so with more than one
 * app instance each enforces the ceiling independently and the effective limit multiplies by the instance
 * count. Same limitation {@link RateLimiter} and {@code GlobalResourceBudget} carry, same owner: issue #85.
 */
public final class StreamSubscriptionQuota {

    private final int maxPerTenant;

    /** Open-stream count per tenant. Entries are created on demand and never removed (see javadoc). */
    private final ConcurrentHashMap<String, AtomicInteger> openStreams = new ConcurrentHashMap<>();

    public StreamSubscriptionQuota(RateLimitProperties properties) {
        Objects.requireNonNull(properties, "properties must not be null");
        this.maxPerTenant = properties.maxConcurrentStreams();
    }

    /**
     * Claims one open-stream slot for {@code tenantId}. <b>This is not a query</b> — a successful claim
     * raises the tenant's count and the caller owes exactly one {@link #close(String)} when the stream
     * ends, on every termination path.
     *
     * @return {@code true} if the stream fits under the ceiling (the count was raised); {@code false} if
     *     the tenant is already at it, in which case nothing changed
     */
    public boolean tryOpen(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        AtomicInteger open = openStreams.computeIfAbsent(tenantId, key -> new AtomicInteger());
        // Check and raise in one atomic step: two threads racing for the last slot must not both win.
        // Same compare-and-set loop as GlobalResourceBudget#tryReserve.
        int current;
        do {
            current = open.get();
            if (current >= maxPerTenant) {
                return false;
            }
        } while (!open.compareAndSet(current, current + 1));
        return true;
    }

    /**
     * Returns one slot to {@code tenantId}. Floored at zero, so a duplicate or spurious close can never
     * drive the count negative and hand the tenant headroom it does not have — the same guard {@code
     * GlobalResourceBudget#release} applies for the same reason.
     *
     * <p>Unknown tenant is a no-op rather than an error: closing is called from stream-termination paths,
     * and throwing there would surface as an unrelated failure on a call that already ended.
     */
    public void close(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        AtomicInteger open = openStreams.get(tenantId);
        if (open == null) {
            return;
        }
        open.updateAndGet(current -> Math.max(0, current - 1));
    }

    /** Streams currently open for {@code tenantId}. Package-private for tests and future gauges. */
    int openCount(String tenantId) {
        AtomicInteger open = openStreams.get(tenantId);
        return open == null ? 0 : open.get();
    }

    /** Tenants this quota has seen. Package-private for tests; the seam to expose as a gauge if needed. */
    int trackedTenantCount() {
        return openStreams.size();
    }
}
