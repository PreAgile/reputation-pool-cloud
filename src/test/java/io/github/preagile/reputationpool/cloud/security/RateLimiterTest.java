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

        assertThat(limiter.check("t1").allowed()).isTrue();
        assertThat(limiter.check("t1").allowed()).isTrue();
        assertThat(limiter.check("t1").allowed()).isTrue();

        assertThat(limiter.check("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("시간이 지나 토큰이 보충되면 → 다시 허용된다")
    void refillsOverTime() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 2);
        limiter.check("t1");
        limiter.check("t1");
        assertThat(limiter.check("t1").allowed()).isFalse();

        // 초당 10개면 100ms 에 1개가 찬다.
        clock.advance(Duration.ofMillis(100));

        assertThat(limiter.check("t1").allowed()).isTrue();
    }

    @Test
    @DisplayName("오래 쉬어도 버스트 한도를 넘겨 쌓이지 않는다 → 장시간 유휴 뒤 무제한 폭주를 막는다")
    void refillCapsAtBurst() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 3);
        limiter.check("t1");

        clock.advance(Duration.ofHours(1));

        assertThat(limiter.check("t1").allowed()).isTrue();
        assertThat(limiter.check("t1").allowed()).isTrue();
        assertThat(limiter.check("t1").allowed()).isTrue();
        assertThat(limiter.check("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("테넌트마다 버킷이 따로다 → 한 테넌트가 소진해도 다른 테넌트는 영향을 받지 않는다")
    void bucketsAreIsolatedPerTenant() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 1);

        assertThat(limiter.check("noisy").allowed()).isTrue();
        assertThat(limiter.check("noisy").allowed()).isFalse();

        assertThat(limiter.check("quiet").allowed()).isTrue();
    }

    @Test
    @DisplayName("거부할 때 retryAfter 는 최소 1초다 → 0 을 주면 호출자가 즉시 재시도해 루프가 된다")
    void retryAfterIsNeverZero() {
        MutableClock clock = new MutableClock(START);
        // 초당 100개면 토큰 하나가 10ms 만에 차므로 반올림 없이는 0초가 나온다.
        RateLimiter limiter = limiter(clock, 100, 1);
        limiter.check("t1");

        RateLimiter.Decision denied = limiter.check("t1");

        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfterSeconds()).isGreaterThanOrEqualTo(1L);
    }

    @Test
    @DisplayName("거부 시 retryAfter 는 실제로 토큰이 찰 때까지의 시간이다 → 그만큼 기다리면 통과한다")
    void retryAfterIsHonest() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 0.5, 1); // 2초에 1개
        limiter.check("t1");

        RateLimiter.Decision denied = limiter.check("t1");
        assertThat(denied.allowed()).isFalse();

        clock.advance(Duration.ofSeconds(denied.retryAfterSeconds()));

        assertThat(limiter.check("t1").allowed()).isTrue();
    }

    @Test
    @DisplayName("비활성화하면 → 아무리 호출해도 항상 허용한다 (사고 시 즉시 해제하는 탈출구)")
    void disabledAlwaysAllows() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = new RateLimiter(new RateLimitProperties(false, 1, 1), clock);

        for (int i = 0; i < 100; i++) {
            assertThat(limiter.check("t1").allowed()).isTrue();
        }
        assertThat(limiter.enabled()).isFalse();
    }

    @Test
    @DisplayName("시계가 뒤로 가도 토큰이 늘지 않는다 → NTP 보정으로 상한이 조용히 풀리지 않는다")
    void backwardClockDoesNotMintTokens() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 10, 2);
        limiter.check("t1");
        limiter.check("t1");

        clock.advance(Duration.ofSeconds(-60));

        assertThat(limiter.check("t1").allowed()).isFalse();
    }

    @Test
    @DisplayName("가득 찬(유휴) 버킷은 정리된다 → 테넌트가 늘어도 메모리가 남지 않는다")
    void sweepsIdleBuckets() {
        MutableClock clock = new MutableClock(START);
        RateLimiter limiter = limiter(clock, 1000, 1);
        // 임계치를 넘겨야 sweep 이 돈다. 넘긴 뒤 한 번 더 호출해 sweep 을 유발한다.
        for (int i = 0; i < 10_002; i++) {
            limiter.check("tenant-" + i);
        }
        int beforeSweep = limiter.trackedTenantCount();

        // 모든 버킷이 가득 찰 만큼 시간을 밀고, sweep 을 유발하는 호출을 한 번 더 한다.
        clock.advance(Duration.ofSeconds(10));
        limiter.check("trigger");

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
