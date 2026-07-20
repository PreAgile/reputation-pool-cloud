package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * Verifies the fail-fast validation in {@link LoginThrottleProperties}'s compact constructor (issue #28).
 * Because Spring instantiates this record during property binding at startup, a rejected value aborts the
 * boot instead of silently self-DoS-ing the sole admin login (e.g. {@code max-attempts: 0}).
 */
class LoginThrottlePropertiesTest {

    private static final Duration D = Duration.ofMinutes(15);

    @Test
    void acceptsValidValues() {
        assertThatCode(() -> new LoginThrottleProperties(true, 5, D, D, 20)).doesNotThrowAnyException();
    }

    @Test
    void rejectsMaxAttemptsBelowOne() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 0, D, D, 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-attempts");
    }

    @Test
    void rejectsGlobalMaxPerSecondBelowOne() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, D, D, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("global-max-per-second");
    }

    @Test
    void rejectsZeroWindow() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, Duration.ZERO, D, 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("window");
    }

    @Test
    void rejectsNegativeBlockDuration() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, D, Duration.ofSeconds(-1), 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("block-duration");
    }
}
