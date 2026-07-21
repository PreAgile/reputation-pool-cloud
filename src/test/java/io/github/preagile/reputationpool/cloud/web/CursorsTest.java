package io.github.preagile.reputationpool.cloud.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Unit tests for the opaque keyset cursor codec (issue #30): encode/decode must round-trip any valid
 * {@code seq}, and decode must reject anything that is not a well-formed encoding of a non-negative long
 * (the controller maps that rejection to a 400).
 */
@DisplayName("Cursors: audit 이벤트 keyset 커서 encode/decode")
class CursorsTest {

    @ParameterizedTest
    @ValueSource(longs = {0L, 1L, 42L, 500L, 1_000_000L, Long.MAX_VALUE})
    @DisplayName("encode 한 커서를 decode 하면 → 원래 seq 로 정확히 왕복한다")
    void encodeDecode_roundTrips(long seq) {
        assertThat(Cursors.decode(Cursors.encode(seq))).isEqualTo(seq);
    }

    @Test
    @DisplayName("커서는 불투명하다 → 인코딩 결과가 seq 의 10진수 문자열 그대로가 아니다")
    void encodedCursor_isOpaque() {
        assertThat(Cursors.encode(12345L)).isNotEqualTo("12345");
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-base64!!!", "%%%", "***"})
    @DisplayName("Base64 로도 못 읽는 커서를 decode 하면 → IllegalArgumentException")
    void decode_malformedBase64_throws(String cursor) {
        assertThatThrownBy(() -> Cursors.decode(cursor)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("숫자가 아닌 내용을 담은 커서를 decode 하면 → IllegalArgumentException")
    void decode_nonNumericPayload_throws() {
        String bogus = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("abc".getBytes());
        assertThatThrownBy(() -> Cursors.decode(bogus)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("음수 seq 를 담은 커서를 decode 하면 → IllegalArgumentException")
    void decode_negativeSeq_throws() {
        String negative = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("-1".getBytes());
        assertThatThrownBy(() -> Cursors.decode(negative)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("빈/공백 커서를 decode 하면 → IllegalArgumentException")
    void decode_blank_throws() {
        assertThatThrownBy(() -> Cursors.decode("  ")).isInstanceOf(IllegalArgumentException.class);
    }
}
