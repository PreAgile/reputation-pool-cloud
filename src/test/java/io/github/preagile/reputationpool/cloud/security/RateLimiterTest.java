package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("RateLimiter: 테넌트별 토큰 버킷으로 데이터 플레인 요청율을 제한하는 제한기")
class RateLimiterTest {

    private static final Instant START = Instant.parse("2026-07-29T00:00:00Z");

    /** 시간을 손으로 밀 수 있는 시계 — 토큰 보충을 sleep 없이 결정론적으로 검증한다. */
    private static final class MutableClock extends Clock {
        private Instant now;

        private MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration amount) {
            now = now.plus(amount);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }

    private static RateLimiter limiter(MutableClock clock, double perSecond, int burst) {
        return new RateLimiter(new RateLimitProperties(true, perSecond, burst), clock);
    }

    @Test
    @DisplayName("버스트 한도까지는 연달아 허용하고 → 그다음 호출부터 거부한다")
    void allowsBurstThenDenies() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 3);

        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        assertThat(limiter.tryConsume("t1").allowed()).isTrue();

        assertThat(limiter.tryConsume("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("시간이 지나 토큰이 보충되면 → 다시 허용된다")
    void refillsOverTime() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 2);
        limiter.tryConsume("t1");
        limiter.tryConsume("t1");
        assertThat(limiter.tryConsume("t1").allowed()).isFalse();

        // 초당 10개면 100ms 에 1개가 찬다.
        clock.advance(Duration.ofMillis(100));

        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
    }

    @Test
    @DisplayName("오래 쉬어도 버스트 한도를 넘겨 쌓이지 않는다 → 장시간 유휴 뒤 무제한 폭주를 막는다")
    void refillCapsAtBurst() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 3);
        limiter.tryConsume("t1");

        clock.advance(Duration.ofHours(1));

        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        assertThat(limiter.tryConsume("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("테넌트마다 버킷이 따로다 → 한 테넌트가 소진해도 다른 테넌트는 영향을 받지 않는다")
    void bucketsAreIsolatedPerTenant() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 1);

        assertThat(limiter.tryConsume("noisy").allowed()).isTrue();
        assertThat(limiter.tryConsume("noisy").allowed()).isFalse();

        assertThat(limiter.tryConsume("quiet").allowed()).isTrue();
    }

    @Test
    @DisplayName("소진된 테넌트 옆의 새 테넌트는 버스트 전부를 쓴다 → 토큰 하나가 아니라 버킷 하나를 새로 받는다")
    void freshTenantGetsFullBurstNotOneToken() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 3);

        // burst 1 로 검증하면 "quiet 이 토큰 하나를 받았다"까지만 보이고, 그것이 quiet **자신의**
        // 가득 찬 버킷인지 남의 것을 한 모금 얻은 것인지 구분되지 않는다. burst 를 3 으로 두면 갈린다.
        assertThat(limiter.tryConsume("noisy").allowed()).isTrue();
        assertThat(limiter.tryConsume("noisy").allowed()).isTrue();
        assertThat(limiter.tryConsume("noisy").allowed()).isTrue();
        assertThat(limiter.tryConsume("noisy").allowed()).isFalse();

        assertThat(limiter.tryConsume("quiet").allowed()).isTrue();
        assertThat(limiter.tryConsume("quiet").allowed()).isTrue();
        assertThat(limiter.tryConsume("quiet").allowed()).isTrue();
        assertThat(limiter.tryConsume("quiet").allowed()).isFalse();

        // 그리고 quiet 을 다 쓴 것이 noisy 를 되살리지도 않는다 — 격리는 양방향이다.
        assertThat(limiter.tryConsume("noisy").allowed()).isFalse();
    }

    @Test
    @DisplayName("남은 토큰이 1 미만이어도 retryAfter 는 그 잔량을 반영한다 → 0 으로 뭉개면 필요보다 오래 기다리게 한다")
    void retryAfterReflectsPartialTokens() {
        MutableClock clock = new MutableClock(START);
        // 10초에 1개(0.1/s). 잔량이 0 일 때와 0.5 일 때 답이 10초 vs 5초로 갈리는 설정이라
        // "잔량을 본다"와 "항상 0 으로 계산한다"가 구분된다. 기존 두 retryAfter 테스트는 모두
        // 잔량이 정확히 0 인 지점만 짚어서 그 둘을 구분하지 못했다.
        RateLimiter limiter = limiter(clock, 0.1, 1);
        limiter.tryConsume("t1");

        assertThat(limiter.tryConsume("t1").retryAfterSeconds()).isEqualTo(10L);

        clock.advance(Duration.ofSeconds(5)); // 0.5 개가 찬다 — 아직 1 개가 아니라 여전히 거절

        RateLimiter.Decision denied = limiter.tryConsume("t1");
        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfterSeconds()).isEqualTo(5L);
    }

    @Test
    @DisplayName("잔량이 다른 두 테넌트는 retryAfter 도 다르다 → 대기 힌트가 남의 버킷에서 나오지 않는다")
    void retryAfterIsPerTenant() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 0.1, 1);

        limiter.tryConsume("early"); // early 의 잔량 0, 시각 START
        clock.advance(Duration.ofSeconds(5));
        limiter.tryConsume("late"); // late 는 지금 생겨서 잔량 0, 시각 START+5s

        // 이 시점 잔량: early 0.5, late 0.0 — 같은 순간에 물어도 답이 달라야 한다.
        assertThat(limiter.tryConsume("early").retryAfterSeconds()).isEqualTo(5L);
        assertThat(limiter.tryConsume("late").retryAfterSeconds()).isEqualTo(10L);
    }

    @Test
    @DisplayName("거부할 때 retryAfter 는 최소 1초다 → 0 을 주면 호출자가 즉시 재시도해 루프가 된다")
    void retryAfterIsNeverZero() {
        MutableClock clock = new MutableClock(START);
        // 초당 100개면 토큰 하나가 10ms 만에 차므로 반올림 없이는 0초가 나온다.
        RateLimiter limiter = limiter(clock, 100, 1);
        limiter.tryConsume("t1");

        RateLimiter.Decision denied = limiter.tryConsume("t1");

        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfterSeconds()).isGreaterThanOrEqualTo(1L);
    }

    @Test
    @DisplayName("거부 시 retryAfter 는 실제로 토큰이 찰 때까지의 시간이다 → 그만큼 기다리면 통과한다")
    void retryAfterIsHonest() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 0.5, 1); // 2초에 1개
        limiter.tryConsume("t1");

        RateLimiter.Decision denied = limiter.tryConsume("t1");
        assertThat(denied.allowed()).isFalse();

        clock.advance(Duration.ofSeconds(denied.retryAfterSeconds()));

        assertThat(limiter.tryConsume("t1").allowed()).isTrue();
    }

    @Test
    @DisplayName("비활성화하면 → 아무리 호출해도 항상 허용한다 (사고 시 즉시 해제하는 탈출구)")
    void disabledAlwaysAllows() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = new RateLimiter(new RateLimitProperties(false, 1, 1), clock);

        for (int i = 0; i < 100; i++) {
            assertThat(limiter.tryConsume("t1").allowed()).isTrue();
        }
        assertThat(limiter.enabled()).isFalse();
    }

    @Test
    @DisplayName("시계가 뒤로 가도 토큰이 늘지 않는다 → NTP 보정으로 상한이 조용히 풀리지 않는다")
    void backwardClockDoesNotMintTokens() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 2);
        limiter.tryConsume("t1");
        limiter.tryConsume("t1");

        clock.advance(Duration.ofSeconds(-60));

        assertThat(limiter.tryConsume("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("가득 찬(유휴) 버킷은 정리된다 → 테넌트가 늘어도 메모리가 남지 않는다")
    void sweepsIdleBuckets() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 1000, 1);
        // 임계치를 넘겨야 sweep 이 돈다. 넘긴 뒤 한 번 더 호출해 sweep 을 유발한다.
        for (int i = 0; i < 10_002; i++) {
            limiter.tryConsume("tenant-" + i);
        }
        int beforeSweep = limiter.trackedTenantCount();

        // 모든 버킷이 가득 찰 만큼 시간을 밀고, sweep 을 유발하는 호출을 한 번 더 한다.
        clock.advance(Duration.ofSeconds(10));
        limiter.tryConsume("trigger");

        assertThat(beforeSweep).isGreaterThan(10_000);
        assertThat(limiter.trackedTenantCount()).isLessThan(beforeSweep);
    }

    @Test
    @DisplayName("설정이 잘못되면 기동 시점에 죽는다 → 상한 0 으로 조용히 전면 차단되지 않는다")
    void rejectsInvalidConfiguration() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new RateLimitProperties(true, 0, 10))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("requests-per-second");

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new RateLimitProperties(true, 10, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("burst");
    }

    // ── 동시성 ────────────────────────────────────────────────────────────────────────────────────
    //
    // 이 클래스는 `ConcurrentHashMap` + 버킷 인스턴스 모니터로 스스로를 지킨다고 선언한다. 그런데
    // 단일 스레드 테스트는 그 선언을 한 번도 건드리지 않는다 — `synchronized (bucket)` 을 통째로
    // 지워도 위의 테스트는 전부 통과한다. 상한 강제는 경합에서 깨지는 것이 기본값이므로 검증한다.
    //
    // 결정론의 조건: **동시 구간에서 시계를 밀지 않는다.** 그러면 `refill()` 이 매번 elapsed <= 0 으로
    // 빠져나가 토큰이 줄기만 하고, "정확히 burst 만큼"이라는 등식 단정이 성립한다. 시계를 함께 움직이면
    // 허용 수가 타이밍에 따라 흔들려 부등식(<=)밖에 못 쓰고, 그건 유실된 소모를 놓친다.
    // (`MutableClock.now` 는 volatile 이 아니지만 스레드 시작 전에 쓰고 이후로는 읽기만 하므로 안전하다.)

    /** 풀 크기는 반드시 태스크 수 이상이어야 한다 — 아래 랑데부가 그 전제 위에 있다. */
    private static void runConcurrently(int threadCount, java.util.function.IntConsumer body)
            throws InterruptedException {
        // ready/start 2단계 랑데부: 전원이 출발선에 선 뒤 동시에 풀려야 경합이 실제로 일어난다.
        // 풀이 threadCount 보다 작으면 대기 중인 태스크가 스레드를 못 받아 ready.countDown() 조차
        // 못 하고, 메인의 ready.await() 가 영원히 끝나지 않는다(GlobalResourceBudgetTest 와 같은 이유).
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
                    body.accept(i);
                })
                .toList();
        tasks.forEach(pool::execute);

        ready.await();
        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("한 테넌트에 여러 스레드가 동시에 몰려도 → 정확히 burst 만큼만 허용된다 (소모가 유실되지 않는다)")
    void concurrentCallsOnOneTenantNeverExceedBurst() throws InterruptedException {
        // burst 를 스레드 수에 가깝게 잡는 것이 이 테스트의 민감도를 결정한다. burst 가 작으면
        // (예: 20/200) 대부분의 스레드가 이미 빈 버킷을 보고 **거절 경로 = 쓰기 없음**으로 빠져,
        // 정작 다투어야 할 `tokens -= 1.0` 읽기-수정-쓰기에 들어가는 스레드가 초반 20 개뿐이다.
        // 실측: 20/200 으로는 synchronized 를 지워도 3 회 중 1 회만 잡혔다. 150/200 이면 대부분의
        // 스레드가 쓰기 경로에 들어가 유실이 드러난다.
        //
        // 라운드를 여러 번 도는 이유도 같다 — 경합 재현은 확률적이라 한 판으로는 놓칠 수 있다.
        // 올바른 구현에서는 몇 판을 돌든 항상 통과하므로 플래키하지 않다(실패만 확률적이다).
        int burst = 150;
        int threads = 200;
        int rounds = 5;

        for (int round = 1; round <= rounds; round++) {
            MutableClock clock = new MutableClock(START);
            RateLimiter limiter = limiter(clock, 1, burst);
            AtomicInteger allowed = new AtomicInteger();

            // 전원이 같은 이름으로 동시에 들어오므로 버킷 생성(computeIfAbsent)부터 경합한다.
            // 버킷이 둘 만들어져도, 소모가 유실돼도, 결과는 "burst 보다 많이 허용됨"으로 나타난다.
            runConcurrently(threads, i -> {
                if (limiter.tryConsume("hot").allowed()) {
                    allowed.incrementAndGet();
                }
            });

            assertThat(allowed.get()).as("%d 라운드의 허용 수", round).isEqualTo(burst);
        }
    }

    @Test
    @DisplayName("여러 테넌트를 동시에 두드려도 → 테넌트마다 정확히 자기 burst 만큼만 허용된다")
    void concurrentCallsAcrossTenantsStayIsolated() throws InterruptedException {
        MutableClock clock = new MutableClock(START);
        int tenants = 20;
        int burst = 3;
        int callsPerTenant = 10;
        RateLimiter limiter = limiter(clock, 1, burst);
        AtomicInteger[] allowed =
                IntStream.range(0, tenants).mapToObj(i -> new AtomicInteger()).toArray(AtomicInteger[]::new);

        // 테넌트 하나당 10 개 스레드가 동시에 붙는다. 격리가 깨지면 어떤 테넌트는 burst 를 넘고
        // 어떤 테넌트는 못 미친다 — 총합만 보면 상쇄돼 보이므로 테넌트별로 단정한다.
        runConcurrently(tenants * callsPerTenant, i -> {
            int tenant = i % tenants;
            if (limiter.tryConsume("tenant-" + tenant).allowed()) {
                allowed[tenant].incrementAndGet();
            }
        });

        for (int t = 0; t < tenants; t++) {
            assertThat(allowed[t].get()).as("tenant-%d 의 허용 수", t).isEqualTo(burst);
        }
    }
}
