package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
}
