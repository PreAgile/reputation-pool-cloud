package io.github.preagile.reputationpool.cloud.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The alerting knobs are opt-in and fail-safe: {@link AlertProperties#active()} is true only when
 * enabled with a real URL, and the compact constructor fails fast on a bad timeout or a non-http(s) URL
 * so misconfiguration aborts the boot rather than silently swallowing every alert.
 */
@DisplayName("AlertProperties: opt-in·fail-safe 한 알림 설정값 (active 판정과 생성 시 검증)")
class AlertPropertiesTest {

    private static final Duration T = Duration.ofSeconds(2);

    @Test
    @DisplayName("비활성이거나 URL 이 없으면 → active 는 false (기본은 꺼짐)")
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
    @DisplayName("enabled=true 이고 실제 URL 이 있을 때만 → active 는 true")
    void activeOnlyWhenEnabledWithUrl() {
        assertThat(new AlertProperties(true, "https://hooks.example/x", T).active())
                .isTrue();
    }

    @Test
    @DisplayName("http/https URL 은 → 정상적으로 생성된다")
    void acceptsHttpAndHttpsUrls() {
        assertThatCode(() -> new AlertProperties(true, "http://localhost:9000/hook", T))
                .doesNotThrowAnyException();
        assertThatCode(() -> new AlertProperties(true, "https://hooks.example/x", T))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("http(s) 가 아닌 URL(ftp 등)이면 → 생성 시점에 예외로 부팅을 중단시킨다")
    void rejectsNonHttpUrl() {
        assertThatThrownBy(() -> new AlertProperties(true, "ftp://nope/x", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
    }

    @Test
    @DisplayName("http(s) 지만 host 가 없으면 → 생성 시점에 예외로 부팅을 중단시킨다")
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
    @DisplayName("공백 등으로 URI 파싱이 불가능하면 → 생성 시점에 예외로 부팅을 중단시킨다")
    void rejectsMalformedUri() {
        // Embedded whitespace / illegal characters: prefix check passes, but URI parsing fails. Without this
        // the malformed value would only surface later as a swallowed URI.create() exception.
        assertThatThrownBy(() -> new AlertProperties(true, "https://ho st/x", T))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("webhook-url");
    }

    @Test
    @DisplayName("타임아웃이 0 이하이면 → 생성 시점에 예외로 부팅을 중단시킨다")
    void rejectsNonPositiveTimeout() {
        assertThatThrownBy(() -> new AlertProperties(true, "https://hooks.example/x", Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeout");
        assertThatThrownBy(() -> new AlertProperties(true, "https://hooks.example/x", Duration.ofSeconds(-1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("timeout");
    }
}
