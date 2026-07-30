package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("StreamSubscriptionQuota: 테넌트가 동시에 열어 둘 수 있는 이벤트 스트림 수를 상한으로 막는 게이트")
class StreamSubscriptionQuotaTest {

    private static StreamSubscriptionQuota quota(int maxStreams) {
        return new StreamSubscriptionQuota(new RateLimitProperties(true, 10, 50, maxStreams));
    }

    @Test
    @DisplayName("상한까지는 열리고 → 그다음 요청부터 거절한다")
    void refusesBeyondCeiling() {
        StreamSubscriptionQuota quota = quota(3);

        assertThat(quota.tryOpen("acme")).isTrue();
        assertThat(quota.tryOpen("acme")).isTrue();
        assertThat(quota.tryOpen("acme")).isTrue();

        assertThat(quota.tryOpen("acme")).isFalse();
        assertThat(quota.openCount("acme")).isEqualTo(3);
    }

    @Test
    @DisplayName("열린 스트림을 닫으면 → 그 자리에 새 구독이 들어간다")
    void closingFreesCapacity() {
        StreamSubscriptionQuota quota = quota(2);
        quota.tryOpen("acme");
        quota.tryOpen("acme");
        assertThat(quota.tryOpen("acme")).isFalse();

        quota.close("acme");

        assertThat(quota.tryOpen("acme")).isTrue();
        assertThat(quota.openCount("acme")).isEqualTo(2);
    }

    @Test
    @DisplayName("같은 스트림을 두 번 닫아도 → 카운트가 음수로 가지 않는다 (없는 여유가 생기지 않는다)")
    void doubleCloseDoesNotInflateHeadroom() {
        StreamSubscriptionQuota quota = quota(2);
        quota.tryOpen("acme");

        quota.close("acme");
        quota.close("acme");
        quota.close("acme");

        assertThat(quota.openCount("acme")).isZero();
        // 바닥이 0 이 아니라면 여기서 상한을 넘겨 열린다.
        assertThat(quota.tryOpen("acme")).isTrue();
        assertThat(quota.tryOpen("acme")).isTrue();
        assertThat(quota.tryOpen("acme")).isFalse();
    }

    @Test
    @DisplayName("한 번도 연 적 없는 테넌트를 닫아도 → 조용히 넘어간다 (종료 경로에서 터지지 않는다)")
    void closingUnknownTenantIsSilent() {
        StreamSubscriptionQuota quota = quota(2);

        quota.close("never-seen");

        assertThat(quota.openCount("never-seen")).isZero();
    }

    @Test
    @DisplayName("테넌트마다 슬롯이 따로다 → 한 테넌트가 소진해도 다른 테넌트는 영향을 받지 않는다")
    void slotsAreIsolatedPerTenant() {
        StreamSubscriptionQuota quota = quota(2);
        assertThat(quota.tryOpen("noisy")).isTrue();
        assertThat(quota.tryOpen("noisy")).isTrue();
        assertThat(quota.tryOpen("noisy")).isFalse();

        // quiet 은 자기 슬롯을 통째로 받는다 — 남의 것을 한 칸 얻는 것이 아니다.
        assertThat(quota.tryOpen("quiet")).isTrue();
        assertThat(quota.tryOpen("quiet")).isTrue();
        assertThat(quota.tryOpen("quiet")).isFalse();

        // 역방향도 마찬가지: quiet 을 다 써도 noisy 가 되살아나지 않는다.
        assertThat(quota.tryOpen("noisy")).isFalse();
    }

    @Test
    @DisplayName("테넌트가 늘어도 슬롯 기록을 버리지 않는다 → 버리면 그 테넌트의 상한이 조용히 초기화된다")
    void neverEvictsTenantEntries() {
        StreamSubscriptionQuota quota = quota(1);
        for (int i = 0; i < 5_000; i++) {
            quota.tryOpen("tenant-" + i);
        }

        assertThat(quota.trackedTenantCount()).isEqualTo(5_000);
        assertThat(quota.openCount("tenant-0")).isEqualTo(1);
    }

    @Test
    @DisplayName("설정 상한이 1 미만이면 → 기동 시점에 죽는다 (구독이 통째로 막히지 않는다)")
    void rejectsInvalidCeiling() {
        assertThatThrownBy(() -> new RateLimitProperties(true, 10, 50, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("max-concurrent-streams");
    }

    // ── 동시성 ──────────────────────────────────────────────────────────────────────────────────
    //
    // 규범(testing-and-review.md): 경쟁 시점을 스케줄러 운에 맡기지 않고 랑데부로 강제하고, 공유
    // 상태의 불변식을 **등식**으로 단정한다. 상한을 스레드 수에 가깝게 잡는 것이 민감도를 정한다 —
    // 상한이 작으면 대부분의 스레드가 이미 찬 카운터를 보고 쓰기 없이 빠져나가, 정작 다투어야 할
    // 읽기-수정-쓰기에 들어가는 스레드가 얼마 없다(RateLimiter 에서 실측으로 확인한 함정).

    private static void runConcurrently(int threadCount, Runnable body) throws InterruptedException {
        // 풀 크기 >= 태스크 수여야 한다: 전원이 ready 를 세고 start 에서 대기하는 2단계 랑데부라,
        // 풀이 작으면 남은 태스크가 스레드를 못 받아 ready.await() 가 영원히 끝나지 않는다.
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        CountDownLatch ready = new CountDownLatch(threadCount);
        CountDownLatch start = new CountDownLatch(1);

        List<Runnable> tasks = IntStream.range(0, threadCount)
                .<Runnable>mapToObj(i -> () -> {
                    ready.countDown();
                    try {
                        start.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                    body.run();
                })
                .toList();
        tasks.forEach(pool::execute);

        ready.await();
        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("여러 스레드가 마지막 슬롯을 동시에 다투면 → 정확히 상한만큼만 성공한다")
    void concurrentOpensNeverExceedCeiling() throws InterruptedException {
        int ceiling = 150;
        int threads = 200;
        int rounds = 5;

        for (int round = 1; round <= rounds; round++) {
            StreamSubscriptionQuota quota = quota(ceiling);
            AtomicInteger admitted = new AtomicInteger();

            runConcurrently(threads, () -> {
                if (quota.tryOpen("hot")) {
                    admitted.incrementAndGet();
                }
            });

            assertThat(admitted.get()).as("%d 라운드의 허용 수", round).isEqualTo(ceiling);
            assertThat(quota.openCount("hot")).as("%d 라운드의 카운터", round).isEqualTo(ceiling);
        }
    }

    @Test
    @DisplayName("열기와 닫기가 동시에 섞여도 → 카운터가 실제 열린 수와 어긋나지 않는다")
    void concurrentOpenAndCloseStayConsistent() throws InterruptedException {
        int ceiling = 200;
        StreamSubscriptionQuota quota = quota(ceiling);
        AtomicInteger stillOpen = new AtomicInteger();

        // 절반은 열고 두고, 절반은 열었다가 곧바로 닫는다. 최종 카운트는 "열고 둔 수" 와 정확히 같아야
        // 한다 — 소모나 반납이 유실되면 어긋난다.
        runConcurrently(200, () -> {
            if (quota.tryOpen("mixed")) {
                if (Thread.currentThread().getId() % 2 == 0) {
                    quota.close("mixed");
                } else {
                    stillOpen.incrementAndGet();
                }
            }
        });

        assertThat(quota.openCount("mixed")).isEqualTo(stillOpen.get());
    }
}
