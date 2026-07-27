package io.github.preagile.reputationpool.cloud.metrics;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;

/**
 * Publishes the domain-surge alert thresholds as gauges so {@code monitoring/alerts.yml} can compare
 * observed rates against configured values (issue #77).
 *
 * <p><b>Why a gauge and not a literal in the rule file.</b> Prometheus performs no environment-variable
 * expansion inside rule files, so a threshold written as {@code > 10} there is only changeable by editing
 * the file and reloading Prometheus. Exposing it as a series instead means the number follows this
 * repository's usual configuration route — {@code application.yml} plus an environment variable — and it
 * becomes visible in Prometheus and plottable in Grafana directly beside the rate it gates, so an operator
 * can see the remaining headroom instead of inferring it.
 *
 * <p><b>Registered unconditionally at startup</b>, for the same reason {@link MetricsEventSink}
 * pre-registers its counters: to a rule, an absent series and a present one mean very different things.
 * A comparison against a missing threshold series yields no result, which would silently disable the
 * alert rather than break it loudly — so the series must exist from the first scrape. {@code alerts.yml}
 * additionally carries an {@code absent()} watchdog for exactly that failure mode.
 *
 * <p>These are constants for the process lifetime: the gauges read from the bound
 * {@link ReputationPoolProperties.SurgeThresholds} record, so changing a threshold means a restart (the
 * same contract as every other value in that record). Values are transitions per minute, matching the
 * {@code rate(...) * 60} form the rules use so the rule and the knob are in the same unit.
 */
public final class SurgeThresholdMetrics {

    static final String COOLING_SURGE_THRESHOLD = "reputation.alert.cooling.surge.threshold";
    static final String BLOCKING_SURGE_THRESHOLD = "reputation.alert.blocking.surge.threshold";

    public SurgeThresholdMetrics(MeterRegistry registry, ReputationPoolProperties.SurgeThresholds thresholds) {
        Objects.requireNonNull(registry, "registry must not be null");
        Objects.requireNonNull(thresholds, "thresholds must not be null");

        Gauge.builder(COOLING_SURGE_THRESHOLD, thresholds, ReputationPoolProperties.SurgeThresholds::coolingPerMinute)
                .description("Transitions into COOLING per minute above which ResourceCoolingSurge fires")
                .strongReference(true)
                .register(registry);
        Gauge.builder(BLOCKING_SURGE_THRESHOLD, thresholds, ReputationPoolProperties.SurgeThresholds::blockingPerMinute)
                .description("BLOCKED-caused COOLING transitions per minute above which UpstreamBlockingSurge fires")
                .strongReference(true)
                .register(registry);
    }
}
