package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The interim registry must route every tenant to the one shared pool (single-tenant correctness)
 * until #9b replaces it with real per-tenant pools.
 */
@DisplayName("SinglePoolTenantRegistry: 모든 테넌트를 하나의 공유 풀로 라우팅하는 임시 레지스트리")
class SinglePoolTenantRegistryTest {

    private final ResourcePool pool = new ResourcePool(
            new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
            new WeightedRandomSelectionStrategy(),
            new EventBroadcaster(),
            Clock.fixed(Instant.parse("2026-07-17T00:00:00Z"), ZoneOffset.UTC),
            new Random(42),
            Duration.ofSeconds(30));

    @Test
    @DisplayName("어떤 테넌트로 요청해도 → 항상 동일한 공유 풀 인스턴스를 반환한다")
    void routesEveryTenantToTheSharedPool() {
        TenantPoolRegistry registry = new SinglePoolTenantRegistry(pool);

        assertThat(registry.poolFor("tenant-a")).isSameAs(pool);
        assertThat(registry.poolFor("tenant-b")).isSameAs(pool);
    }

    @Test
    @DisplayName("테넌트를 온보딩해도 → 예외 없이 no-op 이고 여전히 같은 공유 풀로 resolve 된다")
    void onboardIsANoOpThatStillResolves() {
        TenantPoolRegistry registry = new SinglePoolTenantRegistry(pool);

        assertThatCode(() -> registry.onboard("tenant-c")).doesNotThrowAnyException();
        assertThat(registry.poolFor("tenant-c")).isSameAs(pool);
    }
}
