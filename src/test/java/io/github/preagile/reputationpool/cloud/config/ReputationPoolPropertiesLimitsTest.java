package io.github.preagile.reputationpool.cloud.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Verifies the fail-fast validation in {@link ReputationPoolProperties.Limits}'s compact constructor
 * (issue #84). Spring instantiates this record during property binding at startup, so an invalid budget
 * (e.g. {@code max-resources: 0}) aborts the boot instead of silently refusing every tenant's first call.
 */
@DisplayName("ReputationPoolProperties.Limits: 잘못된 전역 예산 설정값을 부팅 시점에 즉시 거부하는 설정 레코드")
class ReputationPoolPropertiesLimitsTest {

    @Test
    @DisplayName("모든 값이 양수면 → 예외 없이 정상 생성된다")
    void acceptsPositiveValues() {
        assertThatCode(() -> new ReputationPoolProperties.Limits(100_000, 500_000))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("max-resources 가 0이면 → IllegalArgumentException 을 던진다")
    void rejectsZeroMaxResources() {
        assertThatThrownBy(() -> new ReputationPoolProperties.Limits(0, 500_000))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-resources");
    }

    @Test
    @DisplayName("max-resources 가 음수면 → IllegalArgumentException 을 던진다")
    void rejectsNegativeMaxResources() {
        assertThatThrownBy(() -> new ReputationPoolProperties.Limits(-1, 500_000))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-resources");
    }

    @Test
    @DisplayName("max-cells 가 0이면 → IllegalArgumentException 을 던진다")
    void rejectsZeroMaxCells() {
        assertThatThrownBy(() -> new ReputationPoolProperties.Limits(100_000, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-cells");
    }

    @Test
    @DisplayName("max-cells 가 음수면 → IllegalArgumentException 을 던진다")
    void rejectsNegativeMaxCells() {
        assertThatThrownBy(() -> new ReputationPoolProperties.Limits(100_000, -5))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-cells");
    }
}
