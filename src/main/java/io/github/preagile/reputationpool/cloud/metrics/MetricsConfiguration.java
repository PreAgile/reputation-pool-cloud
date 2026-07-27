package io.github.preagile.reputationpool.cloud.metrics;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the {@link MetricsEventSink} (issue #45, metric consumption). It is registered as a bean here and
 * joined into the pool's fan-out sink by {@code EngineConfiguration#poolEventSink}, mirroring how
 * {@code AlertConfiguration} contributes the alerting sink. The {@link MeterRegistry} is Spring Boot's
 * auto-configured one (a {@code PrometheusMeterRegistry} once {@code micrometer-registry-prometheus} is on
 * the classpath), so no registry is created here.
 *
 * <p>Also registers {@link SurgeThresholdMetrics} (issue #77), which publishes the configured surge-alert
 * thresholds as gauges for {@code monitoring/alerts.yml} to compare against.
 */
@Configuration(proxyBeanMethods = false)
public class MetricsConfiguration {

    @Bean
    MetricsEventSink metricsEventSink(MeterRegistry meterRegistry) {
        return new MetricsEventSink(meterRegistry);
    }

    @Bean
    SurgeThresholdMetrics surgeThresholdMetrics(MeterRegistry meterRegistry, ReputationPoolProperties properties) {
        return new SurgeThresholdMetrics(meterRegistry, properties.surgeThresholds());
    }
}
