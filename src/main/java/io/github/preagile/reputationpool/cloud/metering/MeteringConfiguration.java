package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires usage metering (issue #10). The {@link MeterRecorder} is the shared in-memory counter — the
 * per-tenant pools write to it (via {@code TenantMeteringSink}) and the {@link MeteringRollup} drains it
 * — so it is a singleton bean both sides inject. The rollup's {@code @Scheduled} flush runs under the
 * {@code @EnableScheduling} already declared on the engine composition root.
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
}
