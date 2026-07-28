package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Freshness is the only signal a failing checkpoint produces, so what this class reports has to be exact
 * (issue #80). Three behaviours carry the design and are pinned here.
 *
 * <p>A round counts only when <em>every</em> tenant saved — treating a partial round as success would let
 * one permanently failing tenant hide behind its healthy neighbours, which is precisely the state the
 * gauge exists to reveal. A freshly booted process reads near zero rather than as a fault, so the alert
 * does not fire on every deploy while still catching a process whose checkpoints never succeed. And
 * nothing here throws, because this runs inside the checkpoint and restore paths and instrumentation must
 * not be able to break the chore it observes.
 *
 * <p>Time is driven by a mutable {@link Clock} so age is asserted exactly instead of slept for.
 */
@DisplayName("CheckpointFreshness: 마지막 전체 성공 체크포인트 이후 경과를 지표로 노출하는 신선도 추적기")
class CheckpointFreshnessTest {

    private static final Instant BOOT = Instant.parse("2026-07-28T00:00:00Z");
    private static final Duration INTERVAL = Duration.ofSeconds(30);

    /** A clock the test advances by hand, so "60 seconds later" is exact and instant. */
    private static final class MovableClock extends Clock {
        private Instant now;

        private MovableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }

    private MovableClock clock;
    private MeterRegistry registry;
    private CheckpointFreshness freshness;

    private void setUp() {
        clock = new MovableClock(BOOT);
        registry = new SimpleMeterRegistry();
        freshness = new CheckpointFreshness(clock, registry, INTERVAL);
    }

    private double age() {
        return registry.get(CheckpointFreshness.AGE).gauge().value();
    }

    private double counter(String name) {
        return registry.get(name).counter().count();
    }

    @Nested
    @DisplayName("콜드 스타트: 아직 한 번도 체크포인트가 돌지 않은 상태")
    class ColdStart {

        @Test
        @DisplayName("기동 직후면 → 신선도가 0 이다 (배포할 때마다 알림이 울리지 않는다)")
        void freshlyBootedReportsZero() {
            setUp();

            assertThat(age()).isZero();
        }

        @Test
        @DisplayName("체크포인트가 한 번도 성공하지 못한 채 시간이 흐르면 → 신선도가 그만큼 증가한다 (영영 0 으로 거짓말하지 않는다)")
        void withoutAnySuccessfulRoundTheAgeGrows() {
            setUp();

            clock.advance(Duration.ofSeconds(120));

            assertThat(age()).isEqualTo(120);
        }

        @Test
        @DisplayName("기동 시점에도 → 두 카운터가 0 으로 미리 등록돼 있다 (시계열 부재와 값 0 을 구분한다)")
        void preRegistersCountersAtZero() {
            setUp();

            assertThat(counter(CheckpointFreshness.CHECKPOINT_FAILURES)).isZero();
            assertThat(counter(CheckpointFreshness.RESTORE_FAILURES)).isZero();
        }
    }

    @Nested
    @DisplayName("라운드 기록: 전부 성공했을 때만 신선도가 초기화된다")
    class Rounds {

        @Test
        @DisplayName("모든 테넌트가 저장에 성공하면 → 신선도가 0 으로 돌아간다")
        void aFullySuccessfulRoundResetsTheAge() {
            setUp();
            clock.advance(Duration.ofSeconds(90));

            freshness.recordRound(0);

            assertThat(age()).isZero();
        }

        @Test
        @DisplayName("한 테넌트만 실패해도 → 신선도가 초기화되지 않고 계속 증가한다 (한 테넌트의 실패가 이웃 뒤에 숨지 않는다)")
        void aSingleFailingTenantKeepsTheAgeGrowing() {
            setUp();
            clock.advance(Duration.ofSeconds(30));
            freshness.recordRound(0); // 정상 라운드 한 번 — 여기서 신선도가 0 이 된다

            clock.advance(Duration.ofSeconds(30));
            freshness.recordRound(1); // 4개 중 1개 실패
            clock.advance(Duration.ofSeconds(30));
            freshness.recordRound(1);

            // 마지막 전체 성공 이후 60초가 흘렀다 — 실패한 라운드는 신선도를 갱신하지 못한다.
            assertThat(age()).isEqualTo(60);
        }

        @Test
        @DisplayName("실패한 테넌트 수만큼 → 체크포인트 실패 카운터가 증가한다 (만성 실패와 일시적 한 번을 구별한다)")
        void failuresAreCountedPerTenant() {
            setUp();

            freshness.recordRound(2);
            freshness.recordRound(3);

            assertThat(counter(CheckpointFreshness.CHECKPOINT_FAILURES)).isEqualTo(5);
        }

        @Test
        @DisplayName("전부 성공한 라운드는 → 실패 카운터를 건드리지 않는다")
        void aSuccessfulRoundDoesNotTouchTheFailureCounter() {
            setUp();

            freshness.recordRound(0);

            assertThat(counter(CheckpointFreshness.CHECKPOINT_FAILURES)).isZero();
        }

        @Test
        @DisplayName("실패하던 테넌트가 회복돼 전부 성공하면 → 신선도가 다시 0 으로 돌아간다")
        void recoveringResetsTheAgeAgain() {
            setUp();
            freshness.recordRound(1);
            clock.advance(Duration.ofSeconds(90));

            freshness.recordRound(0);

            assertThat(age()).isZero();
        }
    }

    @Nested
    @DisplayName("리스토어 실패: 신선도로는 보이지 않는 손실 경로를 카운터로 드러낸다")
    class RestoreFailures {

        @Test
        @DisplayName("리스토어가 실패하면 → 리스토어 실패 카운터만 증가하고 신선도는 그대로다 (그 뒤 저장은 성공하므로 신선도로는 잡히지 않는다)")
        void restoreFailureIsCountedButDoesNotAffectFreshness() {
            setUp();
            freshness.recordRestoreFailure();
            clock.advance(Duration.ofSeconds(30));
            freshness.recordRound(0); // 빈 풀이지만 저장 자체는 성공한다

            assertThat(counter(CheckpointFreshness.RESTORE_FAILURES)).isEqualTo(1);
            assertThat(age()).isZero();
        }
    }

    @Nested
    @DisplayName("관측 장치가 관측 대상을 망가뜨리지 않는다")
    class NeverThrows {

        @Test
        @DisplayName("어떤 기록 호출도 → 예외를 던지지 않는다 (체크포인트 도중 호출되므로 던지면 작업이 중단된다)")
        void recordingNeverThrows() {
            setUp();

            assertThatCode(() -> {
                        freshness.recordRound(0);
                        freshness.recordRound(7);
                        freshness.recordRestoreFailure();
                        freshness.ageSeconds();
                    })
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("시계가 뒤로 가도 → 신선도가 음수가 되지 않는다 (NTP 보정 등으로 음수 나이가 노출되면 알림식이 오작동한다)")
        void ageIsNeverNegativeWhenTheClockStepsBackwards() {
            setUp();
            freshness.recordRound(0);

            clock.advance(Duration.ofSeconds(-45));

            assertThat(age()).isZero();
        }
    }

    @Nested
    @DisplayName("설정 노출: 알림 임계값이 파생될 기준값")
    class IntervalGauge {

        @Test
        @DisplayName("설정된 체크포인트 주기가 → 게이지로 노출된다 (룰이 이 값의 배수를 임계로 쓴다)")
        void publishesTheConfiguredInterval() {
            setUp();

            assertThat(registry.get(CheckpointFreshness.INTERVAL).gauge().value())
                    .isEqualTo(30);
        }

        @Test
        @DisplayName("주기를 60초로 바꿔 설정하면 → 게이지도 60 을 노출한다 (설정 변경이 알림 임계까지 따라간다)")
        void reflectsAnOverriddenInterval() {
            MeterRegistry other = new SimpleMeterRegistry();
            new CheckpointFreshness(new MovableClock(BOOT), other, Duration.ofSeconds(60));

            assertThat(other.get(CheckpointFreshness.INTERVAL).gauge().value()).isEqualTo(60);
        }
    }
}
