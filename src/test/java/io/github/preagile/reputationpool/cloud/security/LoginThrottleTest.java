package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the IP-based login limiter (issue #28), driven by an adjustable {@link Clock} so the
 * sliding window, the temporary block, and its expiry are deterministic — no sleeping.
 */
class LoginThrottleTest {

    private static final Duration WINDOW = Duration.ofMinutes(15);
    private static final Duration BLOCK = Duration.ofMinutes(15);

    private final MutableClock clock = new MutableClock(Instant.parse("2026-07-20T00:00:00Z"));

    private LoginThrottle throttle(int maxAttempts, int globalMaxPerSecond) {
        LoginThrottleProperties props =
                new LoginThrottleProperties(true, maxAttempts, WINDOW, BLOCK, globalMaxPerSecond);
        return new LoginThrottle(props, clock);
    }

    @Test
    void blocksIpAfterMaxAttempts() {
        LoginThrottle throttle = throttle(5, 100);
        String ip = "203.0.113.7";

        for (int i = 0; i < 4; i++) {
            throttle.recordFailure(ip);
        }
        assertThat(throttle.checkAllowed(ip).allowed()).isTrue();

        throttle.recordFailure(ip); // the 5th failure trips the block

        LoginThrottle.Decision decision = throttle.checkAllowed(ip);
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.retryAfterSeconds()).isEqualTo(BLOCK.getSeconds());
    }

    @Test
    void unblocksAfterBlockDurationElapses() {
        LoginThrottle throttle = throttle(5, 100);
        String ip = "203.0.113.8";

        for (int i = 0; i < 5; i++) {
            throttle.recordFailure(ip);
        }
        assertThat(throttle.checkAllowed(ip).allowed()).isFalse();

        clock.advance(BLOCK.plusSeconds(1));

        assertThat(throttle.checkAllowed(ip).allowed()).isTrue();
    }

    @Test
    void slidingWindowForgetsOldFailures() {
        LoginThrottle throttle = throttle(5, 100);
        String ip = "203.0.113.9";

        for (int i = 0; i < 4; i++) {
            throttle.recordFailure(ip);
        }
        // Slide past the window: the 4 earlier failures no longer count.
        clock.advance(WINDOW.plusSeconds(1));
        for (int i = 0; i < 4; i++) {
            throttle.recordFailure(ip);
        }

        assertThat(throttle.checkAllowed(ip).allowed()).isTrue();
    }

    @Test
    void successResetsCounter() {
        LoginThrottle throttle = throttle(5, 100);
        String ip = "203.0.113.10";

        for (int i = 0; i < 4; i++) {
            throttle.recordFailure(ip);
        }
        throttle.recordSuccess(ip); // counter cleared

        // A fresh batch of 4 must still be allowed — the pre-success failures were forgotten.
        for (int i = 0; i < 4; i++) {
            throttle.recordFailure(ip);
        }
        assertThat(throttle.checkAllowed(ip).allowed()).isTrue();
    }

    @Test
    void globalCeilingDeniesSprayFromManyIps() {
        LoginThrottle throttle = throttle(100, 3); // per-IP effectively off; global ceiling = 3/s

        assertThat(throttle.checkAllowed("198.51.100.1").allowed()).isTrue();
        assertThat(throttle.checkAllowed("198.51.100.2").allowed()).isTrue();
        assertThat(throttle.checkAllowed("198.51.100.3").allowed()).isTrue();

        LoginThrottle.Decision overCap = throttle.checkAllowed("198.51.100.4");
        assertThat(overCap.allowed()).isFalse();
        assertThat(overCap.retryAfterSeconds()).isEqualTo(1);

        // Next second: the global window has slid, attempts are admitted again.
        clock.advance(Duration.ofSeconds(1).plusMillis(1));
        assertThat(throttle.checkAllowed("198.51.100.5").allowed()).isTrue();
    }

    @Test
    void pruneEvictsStaleEntriesButKeepsBlockedOnes() {
        // window 15m, block 1h so a tripped block outlives the window in this test.
        LoginThrottleProperties props = new LoginThrottleProperties(true, 5, WINDOW, Duration.ofHours(1), 100);
        LoginThrottle throttle = new LoginThrottle(props, clock);

        String stale = "203.0.113.20"; // fails twice (sub-threshold), then never returns
        String blocked = "203.0.113.21"; // trips the block

        throttle.recordFailure(stale);
        throttle.recordFailure(stale);
        for (int i = 0; i < 5; i++) {
            throttle.recordFailure(blocked);
        }
        assertThat(throttle.trackedIpCount()).isEqualTo(2);

        // Slide past the window (stale's failures age out) but not past the 1h block.
        clock.advance(WINDOW.plusSeconds(1));

        // Any write triggers the opportunistic prune; add a fresh IP to drive it.
        throttle.recordFailure("203.0.113.22");

        // stale evicted; blocked kept; the fresh IP added → 2 entries.
        assertThat(throttle.trackedIpCount()).isEqualTo(2);
        assertThat(throttle.checkAllowed(blocked).allowed()).isFalse(); // still blocked
        assertThat(throttle.checkAllowed(stale).allowed()).isTrue(); // forgotten → fresh
    }

    @Test
    void pruneKeepsEntriesWithFailuresStillInsideWindow() {
        LoginThrottle throttle = throttle(5, 100);

        throttle.recordFailure("203.0.113.30"); // recent, sub-threshold
        clock.advance(Duration.ofMinutes(1)); // still well inside the 15m window
        throttle.recordFailure("203.0.113.31"); // triggers a prune

        assertThat(throttle.trackedIpCount()).isEqualTo(2); // both are still live
    }

    @Test
    void disabledThrottleAlwaysAllows() {
        LoginThrottleProperties disabled = new LoginThrottleProperties(false, 1, WINDOW, BLOCK, 1);
        LoginThrottle throttle = new LoginThrottle(disabled, clock);
        String ip = "203.0.113.11";

        throttle.recordFailure(ip);
        throttle.recordFailure(ip);

        assertThat(throttle.checkAllowed(ip).allowed()).isTrue();
    }

    /** A {@link Clock} whose instant can be advanced by the test. */
    private static final class MutableClock extends Clock {
        private Instant now;

        private MutableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
