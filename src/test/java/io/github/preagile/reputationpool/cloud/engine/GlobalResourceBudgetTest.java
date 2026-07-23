package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the pure counter/policy behind the shared-JVM global resource budget (issue #84). No
 * gRPC, no core pool involved — just the running-total-vs-ceiling arithmetic that lets a lone tenant use
 * 100% of the budget while several tenants dynamically share it.
 */
@DisplayName("GlobalResourceBudget: 전역 합계가 예산 이내면 통과시키고 초과분만 거부하는 순수 카운터")
class GlobalResourceBudgetTest {

    @Test
    @DisplayName("예산 이내로 리소스를 예약하면 → 매번 true 를 반환하고 카운트가 증가한다")
    void reservationsWithinBudgetSucceed() {
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(3, 10));

        assertThat(budget.tryReserveResource()).isTrue();
        assertThat(budget.tryReserveResource()).isTrue();

        assertThat(budget.resourceCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("예산을 초과해 예약을 시도하면 → false 를 반환하고 카운트는 늘어나지 않는다")
    void reservationBeyondBudgetIsRefusedWithoutSideEffects() {
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(2, 10));

        assertThat(budget.tryReserveResource()).isTrue();
        assertThat(budget.tryReserveResource()).isTrue();
        assertThat(budget.tryReserveResource()).isFalse(); // 3번째: 예산(2) 초과

        assertThat(budget.resourceCount()).isEqualTo(2); // 거부된 시도는 카운트를 건드리지 않는다
    }

    @Test
    @DisplayName("테넌트가 하나뿐이면 → 그 테넌트 혼자 전역 예산 전부를 소진할 수 있다")
    void singleTenantCanConsumeTheEntireGlobalBudget() {
        long maxResources = 5;
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(maxResources, 10));

        for (int i = 0; i < maxResources; i++) {
            assertThat(budget.tryReserveResource())
                    .as("혼자인 테넌트의 %d번째 예약", i + 1)
                    .isTrue();
        }

        // 예산을 정확히 다 썼으므로 그 다음 시도는 거부된다 — "100% 사용 가능"이 정확히 예산까지임을 증명.
        assertThat(budget.tryReserveResource()).isFalse();
        assertThat(budget.resourceCount()).isEqualTo(maxResources);
    }

    @Test
    @DisplayName("테넌트가 둘 이상이면 → 합계가 전역 예산을 넘지 못하고, 한쪽이 많이 쓴 만큼 다른 쪽 여유가 줄어든다")
    void multipleTenantsDynamicallyShareTheSameBudgetWithoutRecomputingQuotas() {
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(5, 10));

        // 테넌트 A가 먼저 3개를 예약 — 개별 몫을 미리 나누지 않았으므로 A는 원하는 만큼 가져갈 수 있다.
        assertThat(budget.tryReserveResource()).isTrue(); // A #1
        assertThat(budget.tryReserveResource()).isTrue(); // A #2
        assertThat(budget.tryReserveResource()).isTrue(); // A #3

        // 테넌트 B가 뒤이어 예약을 시도하면, 남은 예산(5-3=2)만큼만 통과하고 그 다음은 거부된다.
        assertThat(budget.tryReserveResource()).isTrue(); // B #1 (남은 예산 2 -> 1)
        assertThat(budget.tryReserveResource()).isTrue(); // B #2 (남은 예산 1 -> 0)
        assertThat(budget.tryReserveResource()).isFalse(); // B #3: A가 이미 많이 써서 전역 예산이 바닥남

        assertThat(budget.resourceCount()).isEqualTo(5); // 합계는 정확히 전역 예산에서 멈춘다
    }

    @Test
    @DisplayName("리소스 예산과 셀 예산은 → 서로 독립적으로 카운트되어 한쪽 소진이 다른 쪽에 영향을 주지 않는다")
    void resourceAndCellBudgetsAreIndependent() {
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));

        assertThat(budget.tryReserveResource()).isTrue();
        assertThat(budget.tryReserveResource()).isFalse(); // 리소스 예산 소진

        // 리소스 예산이 소진되어도 셀 예산은 별도이므로 여전히 통과한다.
        assertThat(budget.tryReserveCell()).isTrue();
        assertThat(budget.tryReserveCell()).isFalse();
    }

    @Test
    @DisplayName("여러 스레드가 마지막 남은 예산 한 자리를 동시에 다투면 → 정확히 예산만큼만 성공한다")
    void concurrentReservationsNeverExceedTheBudget() throws InterruptedException {
        long max = 20;
        var budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(max, Long.MAX_VALUE));
        int threadCount = 200;
        // 풀 크기는 반드시 threadCount 이상이어야 한다: 모든 태스크가 ready.countDown() 후 start.await()에서
        // 동시에 블록되는 2단계 랑데부 패턴이라, 풀이 이보다 작으면(예: 32) 대기 중인 나머지 태스크가 스레드를
        // 못 받아 ready.countDown()조차 못 하고, 메인 스레드의 ready.await()는 영원히 끝나지 않는 교착 상태가 된다.
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        CountDownLatch ready = new CountDownLatch(threadCount);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger successes = new AtomicInteger();

        List<Runnable> tasks = IntStream.range(0, threadCount)
                .<Runnable>mapToObj(i -> () -> {
                    ready.countDown();
                    try {
                        start.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    if (budget.tryReserveResource()) {
                        successes.incrementAndGet();
                    }
                })
                .toList();
        tasks.forEach(pool::execute);

        ready.await();
        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

        assertThat(successes.get()).isEqualTo(max);
        assertThat(budget.resourceCount()).isEqualTo(max);
    }
}
