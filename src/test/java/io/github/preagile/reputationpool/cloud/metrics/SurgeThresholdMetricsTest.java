package io.github.preagile.reputationpool.cloud.metrics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The surge thresholds must reach Prometheus as gauges, because {@code monitoring/alerts.yml} compares
 * observed rates against those series rather than against literals (issue #77 — Prometheus does not expand
 * environment variables inside rule files).
 *
 * <p>Two properties matter to the rules and are pinned here. First, the gauges exist from construction
 * with the configured values: a rule comparing against a missing series yields no result and would
 * silently stop alerting, so absence is worse than a wrong number. Second, a non-positive threshold is
 * rejected at boot — the rules compare a non-negative rate against it, so zero would fire permanently.
 */
@DisplayName("SurgeThresholdMetrics: 급증 알림 임계값이 게이지로 노출되고 잘못된 값은 부팅 시 거부되는지 검증하는 단위테스트")
class SurgeThresholdMetricsTest {

    @Test
    @DisplayName("기본 설정으로 만들면 → cooling 10 · blocking 1 게이지가 노출된다 (alerts.yml 이 비교할 시계열)")
    void publishesBothThresholdsAsGauges() {
        MeterRegistry registry = new SimpleMeterRegistry();

        new SurgeThresholdMetrics(registry, new ReputationPoolProperties.SurgeThresholds(10, 1));

        assertThat(value(registry, SurgeThresholdMetrics.COOLING_SURGE_THRESHOLD))
                .isEqualTo(10.0);
        assertThat(value(registry, SurgeThresholdMetrics.BLOCKING_SURGE_THRESHOLD))
                .isEqualTo(1.0);
    }

    @Test
    @DisplayName("운영자가 임계값을 바꿔 설정하면 → 게이지도 그 값을 노출한다 (환경변수 조정이 룰까지 도달한다)")
    void reflectsOverriddenThresholds() {
        MeterRegistry registry = new SimpleMeterRegistry();

        new SurgeThresholdMetrics(registry, new ReputationPoolProperties.SurgeThresholds(42.5, 7));

        assertThat(value(registry, SurgeThresholdMetrics.COOLING_SURGE_THRESHOLD))
                .isEqualTo(42.5);
        assertThat(value(registry, SurgeThresholdMetrics.BLOCKING_SURGE_THRESHOLD))
                .isEqualTo(7.0);
    }

    @Test
    @DisplayName("임계값이 0 이거나 음수면 → 부팅 시 거부한다 (0 이면 어떤 활동에도 상시 발화하는 알림 폭풍이 된다)")
    void rejectsNonPositiveThresholds() {
        assertThatThrownBy(() -> new ReputationPoolProperties.SurgeThresholds(0, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cooling-per-minute");

        assertThatThrownBy(() -> new ReputationPoolProperties.SurgeThresholds(10, -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("blocking-per-minute");
    }

    @Test
    @DisplayName("임계값이 NaN 이나 무한이면 → 부팅 시 거부한다 (비교식이 조용히 항상 거짓이 되어 알림이 무동작한다)")
    void rejectsNonFiniteThresholds() {
        assertThatThrownBy(() -> new ReputationPoolProperties.SurgeThresholds(Double.NaN, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cooling-per-minute");

        assertThatThrownBy(() -> new ReputationPoolProperties.SurgeThresholds(10, Double.POSITIVE_INFINITY))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("blocking-per-minute");
    }

    private static double value(MeterRegistry registry, String name) {
        Gauge gauge = registry.find(name).gauge();
        assertThat(gauge).as("게이지 %s 가 등록돼 있어야 한다", name).isNotNull();
        return gauge.value();
    }
}
