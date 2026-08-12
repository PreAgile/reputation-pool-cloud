package io.github.preagile.reputationpool.cloud.policy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * {@link EnginePolicy}'s compact constructor (issue #179). Its whole purpose is to move the upstream
 * engine constructors' range checks forward in time: without it a bad policy is stored successfully and
 * only explodes when that tenant's pool is lazily built, as a 500 on their first gRPC call.
 *
 * <p>Each knob is probed on both sides of its boundary <em>and</em> at an ordinary value in between —
 * checking only the extremes would pass a constructor that accepted nothing but the extremes.
 */
@DisplayName("EnginePolicy: 테넌트 엔진 정책 값 객체 — 잘못된 값을 저장 시점에 거부한다")
class EnginePolicyTest {

    private static final Duration TTL = Duration.ofSeconds(30);

    private static EnginePolicy policy(int windowSize, int coolAfter, int recoverAfter) {
        return new EnginePolicy(windowSize, coolAfter, recoverAfter, TTL, 6, 1.0);
    }

    @Test
    @DisplayName("모든 값이 유효하면 → 그대로 담아 정상 생성된다")
    void acceptsAValidPolicy() {
        EnginePolicy policy = new EnginePolicy(10, 2, 2, TTL, 6, 1.0);

        assertThat(policy.windowSize()).isEqualTo(10);
        assertThat(policy.coolAfter()).isEqualTo(2);
        assertThat(policy.recoverAfter()).isEqualTo(2);
        assertThat(policy.leaseTtl()).isEqualTo(TTL);
        assertThat(policy.cooldownMaxExponent()).isEqualTo(6);
        assertThat(policy.explorationFloor()).isEqualTo(1.0);
    }

    @Nested
    @DisplayName("정수 임계값 세 개(window-size·cool-after·recover-after)")
    class Thresholds {

        @Test
        @DisplayName("1 이면 → 허용한다(하한은 포함이다)")
        void acceptsOne() {
            assertThatCode(() -> policy(1, 1, 1)).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("하한과 상식적인 값 사이의 중간값(3·7)이면 → 허용한다")
        void acceptsValuesBetweenTheBoundaries() {
            assertThatCode(() -> policy(7, 3, 3)).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("window-size 가 0 이면 → window-size 를 지목하며 거부한다")
        void rejectsZeroWindowSize() {
            assertThatThrownBy(() -> policy(0, 2, 2))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("window-size");
        }

        @Test
        @DisplayName("cool-after 가 0 이면 → cool-after 를 지목하며 거부한다")
        void rejectsZeroCoolAfter() {
            assertThatThrownBy(() -> policy(10, 0, 2))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("cool-after");
        }

        @Test
        @DisplayName("recover-after 가 음수면 → recover-after 를 지목하며 거부한다")
        void rejectsNegativeRecoverAfter() {
            assertThatThrownBy(() -> policy(10, 2, -1))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("recover-after");
        }

        @Test
        @DisplayName("여기서 허용한 하한값은 → upstream ReputationEngine 생성자도 그대로 받는다(두 경계가 어긋나지 않는다)")
        void theAcceptedLowerBoundIsAlsoAcceptedUpstream() {
            EnginePolicy lowest = policy(1, 1, 1);

            assertThatCode(() -> new ReputationEngine(
                            new AdaptiveCooldownPolicy(lowest.cooldownMaxExponent()),
                            lowest.windowSize(),
                            lowest.coolAfter(),
                            lowest.recoverAfter()))
                    .doesNotThrowAnyException();
        }
    }

    @Nested
    @DisplayName("lease-ttl")
    class LeaseTtl {

        @Test
        @DisplayName("1ns 든 30초든 양수면 → 허용한다")
        void acceptsAnyPositiveDuration() {
            assertThatCode(() -> new EnginePolicy(10, 2, 2, Duration.ofNanos(1), 6, 1.0))
                    .doesNotThrowAnyException();
            assertThatCode(() -> new EnginePolicy(10, 2, 2, Duration.ofSeconds(30), 6, 1.0))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("0 이면 → 거부한다(리스가 발급 즉시 만료되는 값이다)")
        void rejectsZero() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, Duration.ZERO, 6, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("lease-ttl");
        }

        @Test
        @DisplayName("음수면 → 거부한다")
        void rejectsNegative() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, Duration.ofSeconds(-1), 6, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("lease-ttl");
        }

        @Test
        @DisplayName("null 이면 → NullPointerException 으로 거부한다")
        void rejectsNull() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, null, 6, 1.0)).isInstanceOf(NullPointerException.class);
        }
    }

    @Nested
    @DisplayName("cooldown-max-exponent — upstream 이 정한 [0, MAX_ALLOWED_EXPONENT] 를 그대로 따른다")
    class CooldownMaxExponent {

        @Test
        @DisplayName("0·중간값·MAX_ALLOWED_EXPONENT 면 → 모두 허용한다(양 끝과 그 사이)")
        void acceptsTheWholeUpstreamRange() {
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, 0, 1.0)).doesNotThrowAnyException();
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, 10, 1.0)).doesNotThrowAnyException();
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT, 1.0))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("MAX_ALLOWED_EXPONENT 를 1 넘기면 → 거부한다")
        void rejectsOneAboveTheUpstreamMaximum() {
            assertThatThrownBy(
                            () -> new EnginePolicy(10, 2, 2, TTL, AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT + 1, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("cooldown-max-exponent");
        }

        @Test
        @DisplayName("음수면 → 거부한다")
        void rejectsNegative() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, TTL, -1, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("cooldown-max-exponent");
        }

        @Test
        @DisplayName("여기서 허용한 상한값은 → upstream AdaptiveCooldownPolicy 생성자도 그대로 받는다")
        void theAcceptedUpperBoundIsAlsoAcceptedUpstream() {
            assertThatCode(() -> new AdaptiveCooldownPolicy(AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT))
                    .doesNotThrowAnyException();
        }
    }

    @Nested
    @DisplayName("exploration-floor — upstream 이 요구하는 '유한하고 양수'")
    class ExplorationFloor {

        @Test
        @DisplayName("아주 작은 값·1.0·큰 값이면 → 모두 허용한다")
        void acceptsFinitePositiveValues() {
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, 6, 0.001)).doesNotThrowAnyException();
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, 6, 1.0)).doesNotThrowAnyException();
            assertThatCode(() -> new EnginePolicy(10, 2, 2, TTL, 6, 42.5)).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("0 이면 → 거부한다(후보의 가중치를 0 으로 만들 수 있는 값이다)")
        void rejectsZero() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, TTL, 6, 0.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exploration-floor");
        }

        @Test
        @DisplayName("음수면 → 거부한다")
        void rejectsNegative() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, TTL, 6, -0.5))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exploration-floor");
        }

        @Test
        @DisplayName("NaN·Infinity 면 → 거부한다(양수 비교만으로는 NaN 이 새어 나간다)")
        void rejectsNonFiniteValues() {
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, TTL, 6, Double.NaN))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exploration-floor");
            assertThatThrownBy(() -> new EnginePolicy(10, 2, 2, TTL, 6, Double.POSITIVE_INFINITY))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exploration-floor");
        }

        @Test
        @DisplayName("여기서 허용한 값은 → upstream WeightedRandomSelectionStrategy 생성자도 그대로 받는다")
        void theAcceptedRangeIsAlsoAcceptedUpstream() {
            assertThatCode(() -> new WeightedRandomSelectionStrategy(0.001)).doesNotThrowAnyException();
        }
    }

    @Nested
    @DisplayName("defaultsFrom — 전역 설정으로 조립하는 인스턴스 기본 정책")
    class DefaultsFromProperties {

        @Test
        @DisplayName("전역 설정을 주면 → engine.* 과 lease-ttl 을 그대로 옮긴 정책이 된다(정책 행이 없을 때 쓰는 값)")
        void carriesTheGlobalKnobsUnchanged() {
            ReputationPoolProperties properties = properties(10, 2, 2, 6, 1.0);

            assertThat(EnginePolicy.defaultsFrom(properties))
                    .isEqualTo(new EnginePolicy(10, 2, 2, Duration.ofSeconds(30), 6, 1.0));
        }

        @Test
        @DisplayName("운영자가 전역값을 바꾸면 → 기본 정책도 그 값을 따라간다(기본값이 코드에 박혀 있지 않다)")
        void followsTheOperatorsGlobalOverrides() {
            ReputationPoolProperties properties = properties(25, 4, 3, 8, 2.5);

            assertThat(EnginePolicy.defaultsFrom(properties))
                    .isEqualTo(new EnginePolicy(25, 4, 3, Duration.ofSeconds(30), 8, 2.5));
        }
    }

    static ReputationPoolProperties properties(
            int windowSize, int coolAfter, int recoverAfter, int cooldownMaxExponent, double explorationFloor) {
        return new ReputationPoolProperties(
                Duration.ofSeconds(30),
                Duration.ofSeconds(30),
                new ReputationPoolProperties.Engine(
                        windowSize, coolAfter, recoverAfter, cooldownMaxExponent, explorationFloor),
                new ReputationPoolProperties.Audit(Duration.ofHours(1), Duration.ZERO),
                new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
                new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)),
                new ReputationPoolProperties.Limits(100_000, 500_000),
                new ReputationPoolProperties.SurgeThresholds(10, 1),
                new ReputationPoolProperties.PolicyCeiling(10));
    }
}
