package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires usage metering (issue #10), reputation-score sampling (issue #12) and per-context outcome
 * counting (issue #189). The {@link MeterRecorder} is the shared in-memory counter — the per-tenant pools
 * write to it (via {@code TenantMeteringSink}) and the {@link MeteringRollup} drains it — so it is a
 * singleton bean both sides inject. The {@link ScoreSampler} is a second {@code @Scheduled} sampler over
 * the same live pools. {@link OutcomeRecorder}/{@link OutcomeRollup} repeat the recorder+rollup pair for
 * report outcomes, this time written from the gRPC boundary ({@code ReputationAdvisorService.report})
 * rather than from a pool event, because that is the only place an ordinary success is observable at all.
 * All of them run under the {@code @EnableScheduling} already declared on the engine composition root.
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

    @Bean
    OutcomeRecorder outcomeRecorder() {
        return new OutcomeRecorder();
    }

    @Bean
    OutcomeRollup outcomeRollup(
            DataSource dataSource, Clock clock, OutcomeRecorder outcomeRecorder, ReputationPoolProperties properties) {
        return new OutcomeRollup(dataSource, clock, outcomeRecorder, properties);
    }
}
