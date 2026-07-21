package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Verifies the fail-fast validation in {@link LoginThrottleProperties}'s compact constructor (issue #28).
 * Because Spring instantiates this record during property binding at startup, a rejected value aborts the
 * boot instead of silently self-DoS-ing the sole admin login (e.g. {@code max-attempts: 0}).
 */
@DisplayName("LoginThrottleProperties: 잘못된 설정값을 부팅 시점에 즉시 거부하는 로그인 스로틀 설정 레코드")
class LoginThrottlePropertiesTest {

    private static final Duration D = Duration.ofMinutes(15);

    @Test
    @DisplayName("모든 값이 유효하면 → 예외 없이 정상 생성된다")
    void acceptsValidValues() {
        assertThatCode(() -> new LoginThrottleProperties(true, 5, D, D, 20)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("max-attempts 가 1 미만(0)이면 → IllegalArgumentException 을 던진다")
    void rejectsMaxAttemptsBelowOne() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 0, D, D, 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-attempts");
    }

    @Test
    @DisplayName("global-max-per-second 가 1 미만(0)이면 → IllegalArgumentException 을 던진다")
    void rejectsGlobalMaxPerSecondBelowOne() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, D, D, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("global-max-per-second");
    }

    @Test
    @DisplayName("window 가 0 이면 → IllegalArgumentException 을 던진다")
    void rejectsZeroWindow() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, Duration.ZERO, D, 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("window");
    }

    @Test
    @DisplayName("block-duration 이 음수면 → IllegalArgumentException 을 던진다")
    void rejectsNegativeBlockDuration() {
        assertThatThrownBy(() -> new LoginThrottleProperties(true, 5, D, Duration.ofSeconds(-1), 20))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("block-duration");
    }
}
