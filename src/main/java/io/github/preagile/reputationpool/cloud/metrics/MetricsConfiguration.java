package io.github.preagile.reputationpool.cloud.metrics;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the {@link MetricsEventSink} (issue #45, metric consumption). It is registered as a bean here and
 * joined into the pool's fan-out sink by {@code EngineConfiguration#poolEventSink}, mirroring how
 * {@code AlertConfiguration} contributes the alerting sink. The {@link MeterRegistry} is Spring Boot's
 * auto-configured one (a {@code PrometheusMeterRegistry} once {@code micrometer-registry-prometheus} is on
 * the classpath), so no registry is created here.
 */
@Configuration(proxyBeanMethods = false)
public class MetricsConfiguration {

    @Bean
    MetricsEventSink metricsEventSink(MeterRegistry meterRegistry) {
        return new MetricsEventSink(meterRegistry);
    }
}
