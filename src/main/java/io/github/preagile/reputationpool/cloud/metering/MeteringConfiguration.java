package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires usage metering (issue #10) and reputation-score sampling (issue #12). The {@link MeterRecorder}
 * is the shared in-memory counter — the per-tenant pools write to it (via {@code TenantMeteringSink})
 * and the {@link MeteringRollup} drains it — so it is a singleton bean both sides inject. The
 * {@link ScoreSampler} is a second {@code @Scheduled} sampler over the same live pools. Both run under
 * the {@code @EnableScheduling} already declared on the engine composition root.
 */
@Configuration(proxyBeanMethods = false)
public class MeteringConfiguration {

    @Bean
    MeterRecorder meterRecorder() {
        return new MeterRecorder();
    }

    @Bean
    MeteringRollup meteringRollup(
            DataSource dataSource, Clock clock, MeterRecorder meterRecorder, PerTenantPoolRegistry registry) {
        return new MeteringRollup(dataSource, clock, meterRecorder, registry);
    }

    @Bean
    ScoreSampler scoreSampler(
            DataSource dataSource, Clock clock, PerTenantPoolRegistry registry, ReputationPoolProperties properties) {
        return new ScoreSampler(dataSource, clock, registry, properties);
    }
}
