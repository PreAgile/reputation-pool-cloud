package io.github.preagile.reputationpool.cloud.metering;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader.UsageSummary;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.Lease;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * End-to-end metering (issue #10) against a real PostgreSQL: leases granted through a tenant's pool are
 * counted per tenant, the rollup folds them (and the pool size) into {@code usage_meter}, and the
 * reader returns them. {@code flush-interval=PT1H} parks the scheduled flush so the test drives it
 * explicitly; lease counting is additive, so even an interleaved scheduled flush would not change the
 * total. Requires Docker; runs via {@code ./gradlew integrationTest}.
 */
@SpringBootTest(
        properties = {
            "reputation-pool.auth.api-key=it-key",
            "grpc.server.port=0",
            "reputation-pool.metering.flush-interval=PT1H"
        })
@Import(MeteringIT.Containers.class)
@DisplayName("MeteringIT: 실제 PostgreSQL 의 usage_meter 에 테넌트별 리스 사용량과 풀 크기가 적재·조회되는지 검증하는 통합테스트")
class MeteringIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private PerTenantPoolRegistry registry;

    @Autowired
    private MeteringRollup rollup;

    @Autowired
    private UsageMeterReader usage;

    @Autowired
    private Clock clock;

    @Test
    @DisplayName("리스를 3번 획득·반납하고 롤업을 플러시하면 → 월/일 리스 합계 3, 풀 크기 1 이 테넌트별로 미터링된다")
    void leasesAndPoolSizeAreMeteredPerTenant() {
        ResourcePool pool = registry.poolFor("metering-it");
        pool.register(new ResourceId(ResourceKind.PROXY, "p1"));

        // Three grant→release cycles = three ResourceLeased events for this tenant.
        for (int i = 0; i < 3; i++) {
            Optional<Lease> lease = pool.acquire(new Context("scrape"));
            assertThat(lease)
                    .as("resource is free each cycle, so acquire grants")
                    .isPresent();
            pool.release(lease.get());
        }

        rollup.flush();

        LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
        UsageSummary summary = usage.read("metering-it", today);
        assertThat(summary.monthLeaseTotal()).isEqualTo(3L);
        assertThat(summary.poolSize()).isEqualTo(1L);
        assertThat(summary.dailyLeases()).anySatisfy(day -> {
            assertThat(day.date()).isEqualTo(today);
            assertThat(day.count()).isEqualTo(3L);
        });
    }
}
