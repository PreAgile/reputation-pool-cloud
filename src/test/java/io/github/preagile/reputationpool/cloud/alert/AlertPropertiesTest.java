package io.github.preagile.reputationpool.cloud.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * The alerting knobs are opt-in and fail-safe: {@link AlertProperties#active()} is true only when
 * enabled with a real URL, and the compact constructor fails fast on a bad timeout or a non-http(s) URL
 * so misconfiguration aborts the boot rather than silently swallowing every alert.
 */
class AlertPropertiesTest {

    private static final Duration T = Duration.ofSeconds(2);

    @Test
    void inactiveByDefaultDisabledCombinations() {
        // disabled (the default), regardless of URL
        assertThat(new AlertProperties(false, "", T).active()).isFalse();
        assertThat(new AlertProperties(false, "https://hooks.example/x", T).active())
                .isFalse();
        // enabled but no destination -> still a no-op
        assertThat(new AlertProperties(true, "", T).active()).isFalse();
        assertThat(new AlertProperties(true, "   ", T).active()).isFalse();
    }

    @Test
    void activeOnlyWhenEnabledWithUrl() {
        assertThat(new AlertProperties(true, "https://hooks.example/x", T).active())
                .isTrue();
    }

    @Test
    void acceptsHttpAndHttpsUrls() {
        assertThatCode(() -> new AlertProperties(true, "http://localhost:9000/hook", T))
                .doesNotThrowAnyException();
        assertThatCode(() -> new AlertProperties(true, "https://hooks.example/x", T))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsNonHttpUrl() {
        assertThatThrownBy(() -> new AlertProperties(true, "ftp://nope/x", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
    }

    @Test
    void rejectsHttpUrlWithoutHost() {
        // Passes the http(s) prefix check but carries no host: at send time this would build a hostless URI
        // that HttpRequest rejects, and the notifier swallows that -> a silent no-op. Must fail fast at boot.
        // (Depending on the JDK a hostless authority may surface as a syntax error or a null host; either way
        // it must abort construction, so we assert the fail-fast IllegalArgumentException, not the exact text.)
        assertThatThrownBy(() -> new AlertProperties(true, "https://", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
        assertThatThrownBy(() -> new AlertProperties(true, "http://", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
        assertThatThrownBy(() -> new AlertProperties(true, "https:///no-host-path", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("host");
    }

    @Test
    void rejectsMalformedUri() {
        // Embedded whitespace / illegal characters: prefix check passes, but URI parsing fails. Without this
        // the malformed value would only surface later as a swallowed URI.create() exception.
        assertThatThrownBy(() -> new AlertProperties(true, "https://ho st/x", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
    }

    @Test
    void rejectsNonPositiveTimeout() {
        assertThatThrownBy(() -> new AlertProperties(true, "https://hooks.example/x", Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeout");
        assertThatThrownBy(() -> new AlertProperties(true, "https://hooks.example/x", Duration.ofSeconds(-1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeout");
    }
}
