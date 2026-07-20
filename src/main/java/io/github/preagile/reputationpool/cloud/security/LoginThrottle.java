package io.github.preagile.reputationpool.cloud.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory, {@link Clock}-driven brute-force limiter for the admin login (issue #28). Holds two pieces
 * of state and decides, per attempt, whether the request may reach the login controller:
 *
 * <ul>
 *   <li><b>L1 — per-IP sliding window.</b> Each source IP has a window of recent failure timestamps.
 *       When failures reach {@link LoginThrottleProperties#maxAttempts} within {@link
 *       LoginThrottleProperties#window}, the IP is blocked until {@code now + blockDuration}. A
 *       successful login clears that IP's state ({@link #recordSuccess}).
 *   <li><b>L2 — global rate ceiling.</b> A shared sliding window of the last second's attempts caps
 *       total attempts at {@link LoginThrottleProperties#globalMaxPerSecond} — a safety valve against a
 *       distributed spray where each IP alone stays under the per-IP limit.
 * </ul>
 *
 * <p>No external cache dependency: plain {@link ConcurrentHashMap} plus the injected {@link Clock}
 * (which makes expiry and unblocking unit-testable with a fixed/adjustable clock). Per-IP entries are
 * short-lived and self-pruning; a successful login removes its entry outright.
 *
 * <p>This type is pure decision logic — it emits no logs or metrics. Observability (WARN + counter) is
 * the {@link LoginThrottleFilter}'s job, which owns the request context.
 */
public final class LoginThrottle {

    /**
     * Hard ceiling on tracked IPs — a memory backstop against a massive distributed spray of unique
     * source IPs. Once exceeded (after pruning stale entries), un-blocked counters are shed; blocked IPs
     * (the real defence) and the L2 global ceiling still hold.
     */
    private static final int MAX_TRACKED_IPS = 100_000;

    private final LoginThrottleProperties properties;
    private final Clock clock;

    /** Per-IP failure window + block deadline. Guarded by synchronizing on the value itself. */
    private final ConcurrentHashMap<String, IpState> perIp = new ConcurrentHashMap<>();

    /** Shared timestamps of attempts admitted for the L2 ceiling; guarded by its own monitor. */
    private final Deque<Instant> globalAttempts = new ArrayDeque<>();

    public LoginThrottle(LoginThrottleProperties properties, Clock clock) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public boolean enabled() {
        return properties.enabled();
    }

    /**
     * Whether an attempt from {@code ip} may proceed to the login controller. Blocked IPs and requests
     * over the global ceiling are denied with a {@code Retry-After} hint (seconds). When throttling is
     * disabled the call always allows and records nothing.
     */
    public Decision checkAllowed(String ip) {
        if (!properties.enabled()) {
            return Decision.allow();
        }
        Instant now = clock.instant();

        // L1: is this IP currently blocked?
        IpState state = perIp.get(ip);
        if (state != null) {
            synchronized (state) {
                if (state.blockedUntil != null) {
                    if (now.isBefore(state.blockedUntil)) {
                        return Decision.deny(retryAfterSeconds(now, state.blockedUntil));
                    }
                    // Block elapsed: forget it so the IP starts fresh.
                    perIp.remove(ip, state);
                }
            }
        }

        // L2: global attempts-per-second ceiling (a safety valve for a distributed spray).
        synchronized (globalAttempts) {
            Instant oneSecondAgo = now.minusSeconds(1);
            while (!globalAttempts.isEmpty() && !globalAttempts.peekFirst().isAfter(oneSecondAgo)) {
                globalAttempts.pollFirst();
            }
            if (globalAttempts.size() >= properties.globalMaxPerSecond()) {
                return Decision.deny(1);
            }
            globalAttempts.addLast(now);
        }
        return Decision.allow();
    }

    /**
     * Records one failed login from {@code ip}. Prunes failures older than the window, adds this one, and
     * — if the count reaches {@link LoginThrottleProperties#maxAttempts} — blocks the IP for {@link
     * LoginThrottleProperties#blockDuration}.
     */
    public void recordFailure(String ip) {
        if (!properties.enabled()) {
            return;
        }
        Instant now = clock.instant();
        // Opportunistic sweep on the write path so entries for IPs that failed a few times and never
        // returned cannot accumulate forever (OOM). Writes are naturally rare here — recordFailure runs
        // only for attempts the L2 ceiling already admitted — so a full scan per failure is cheap.
        pruneExpired(now);
        IpState state = perIp.computeIfAbsent(ip, key -> new IpState());
        synchronized (state) {
            Instant windowStart = now.minus(properties.window());
            while (!state.failures.isEmpty() && !state.failures.peekFirst().isAfter(windowStart)) {
                state.failures.pollFirst();
            }
            state.failures.addLast(now);
            if (state.failures.size() >= properties.maxAttempts()) {
                state.blockedUntil = now.plus(properties.blockDuration());
                state.failures.clear();
            }
        }
    }

    /**
     * Evicts entries that no longer carry a live signal: an IP that is not currently blocked and whose
     * most recent failure has aged out of {@link LoginThrottleProperties#window}. If the map still
     * exceeds {@link #MAX_TRACKED_IPS} afterwards (a flood of distinct live IPs), it sheds un-blocked
     * counters as a memory backstop — a graceful degradation that never drops an active block.
     */
    private void pruneExpired(Instant now) {
        perIp.forEach((ip, state) -> {
            synchronized (state) {
                if (isStale(state, now)) {
                    perIp.remove(ip, state);
                }
            }
        });
        if (perIp.size() <= MAX_TRACKED_IPS) {
            return;
        }
        perIp.forEach((ip, state) -> {
            if (perIp.size() <= MAX_TRACKED_IPS) {
                return;
            }
            synchronized (state) {
                if (state.blockedUntil == null || !now.isBefore(state.blockedUntil)) {
                    perIp.remove(ip, state);
                }
            }
        });
    }

    /** Whether an entry can be forgotten: not actively blocked and its newest failure is out of window. */
    private boolean isStale(IpState state, Instant now) {
        if (state.blockedUntil != null && now.isBefore(state.blockedUntil)) {
            return false;
        }
        Instant lastFailure = state.failures.peekLast();
        if (lastFailure == null) {
            return true;
        }
        Instant windowStart = now.minus(properties.window());
        return !lastFailure.isAfter(windowStart);
    }

    /** Number of tracked IP entries — package-private so tests can assert stale entries are evicted. */
    int trackedIpCount() {
        return perIp.size();
    }

    /** Clears an IP's failure/block state after a successful login — legitimate use is not penalised. */
    public void recordSuccess(String ip) {
        if (!properties.enabled()) {
            return;
        }
        perIp.remove(ip);
    }

    private static long retryAfterSeconds(Instant now, Instant until) {
        long seconds = Duration.between(now, until).getSeconds();
        // Round up any sub-second remainder to at least 1, so Retry-After never tells a blocked caller 0.
        return Math.max(1, Duration.between(now, until).toNanos() % 1_000_000_000L == 0 ? seconds : seconds + 1);
    }

    /** The verdict for one attempt: allowed, or denied with a {@code Retry-After} hint in seconds. */
    public record Decision(boolean allowed, long retryAfterSeconds) {
        static Decision allow() {
            return new Decision(true, 0);
        }

        static Decision deny(long retryAfterSeconds) {
            return new Decision(false, retryAfterSeconds);
        }
    }

    /** Mutable per-IP state; every access synchronizes on the instance. */
    private static final class IpState {
        private final Deque<Instant> failures = new ArrayDeque<>();
        private Instant blockedUntil;
    }
}
