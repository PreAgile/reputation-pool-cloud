package io.github.preagile.reputationpool.cloud.policy;

import static io.github.preagile.reputationpool.cloud.policy.EnginePolicyTest.properties;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * {@link EnginePolicyCeiling} (issue #179): the per-instance upper bound on a tenant's policy, and the
 * two properties the design turns on — that it is derived from <em>this instance's</em> static
 * configuration (so differently configured instances get different ceilings) and that nothing about it
 * depends on how many tenants exist (so no ceiling is ever recomputed as tenants come and go).
 */
@DisplayName("EnginePolicyCeiling: 인스턴스 정적 설정에서 유도한 테넌트 정책 상한")
class EnginePolicyCeilingTest {

    private static final Duration TTL = Duration.ofSeconds(30);

    private static EnginePolicyCeiling ceilingOf(int windowSize, int multiple) {
        return EnginePolicyCeiling.from(withMultiple(properties(windowSize, 2, 2, 6, 1.0), multiple));
    }

    private static ReputationPoolProperties withMultiple(ReputationPoolProperties base, int multiple) {
        return new ReputationPoolProperties(
                base.leaseTtl(),
                base.checkpointInterval(),
                base.engine(),
                base.audit(),
                base.metering(),
                base.score(),
                base.limits(),
                base.surgeThresholds(),
                new ReputationPoolProperties.PolicyCeiling(multiple));
    }

    @Nested
    @DisplayName("상한 산출")
    class Derivation {

        @Test
        @DisplayName("기본값 window-size=10, 배수 10 이면 → 상한은 100 이다(설정된 기본값의 배수)")
        void scalesEachKnobByTheConfiguredMultiple() {
            EnginePolicyCeiling ceiling = ceilingOf(10, 10);

            assertThat(ceiling.maxWindowSize()).isEqualTo(100);
            assertThat(ceiling.maxCoolAfter()).isEqualTo(20);
            assertThat(ceiling.maxRecoverAfter()).isEqualTo(20);
            assertThat(ceiling.maxLeaseTtl()).isEqualTo(Duration.ofSeconds(300));
            assertThat(ceiling.maxExplorationFloor()).isEqualTo(10.0);
        }

        @Test
        @DisplayName("같은 배수라도 인스턴스가 window-size=5 로 설정돼 있으면 → 상한은 50 이다(인스턴스마다 다르다)")
        void aDifferentlyConfiguredInstanceGetsADifferentCeiling() {
            assertThat(ceilingOf(5, 10).maxWindowSize()).isEqualTo(50);
            assertThat(ceilingOf(20, 10).maxWindowSize()).isEqualTo(200);
        }

        @Test
        @DisplayName("배수를 1 로 두면 → 상한이 인스턴스 기본값 자체가 된다(기본값과 똑같은 정책은 항상 저장 가능하다)")
        void aMultipleOfOnePinsTheCeilingToTheDefaultItself() {
            EnginePolicyCeiling ceiling = ceilingOf(10, 1);

            assertThat(ceiling.maxWindowSize()).isEqualTo(10);
            assertThatCode(() -> ceiling.check(new EnginePolicy(10, 2, 2, TTL, 6, 1.0)))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("배수를 키워 쿨다운 지수 상한이 upstream 한계를 넘어가면 → MAX_ALLOWED_EXPONENT 로 잘린다")
        void theCooldownExponentCeilingIsClampedToTheUpstreamHardLimit() {
            // 6 × 10 = 60, well past the point where the computed cooldown overflows Duration.
            assertThat(ceilingOf(10, 10).maxCooldownMaxExponent())
                    .isEqualTo(AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT);
            // Below the clamp the multiple still applies: 6 × 2 = 12.
            assertThat(ceilingOf(10, 2).maxCooldownMaxExponent()).isEqualTo(12);
        }

        @Test
        @DisplayName("최대 배수(1000)를 써도 → 정수 상한이 음수로 뒤집히지 않는다")
        void aLargeMultipleSaturatesInsteadOfOverflowing() {
            EnginePolicyCeiling ceiling =
                    EnginePolicyCeiling.from(withMultiple(properties(Integer.MAX_VALUE, 2, 2, 6, 1.0), 1_000));

            assertThat(ceiling.maxWindowSize()).isEqualTo(Integer.MAX_VALUE);
        }
    }

    @Nested
    @DisplayName("검사")
    class Check {

        private final EnginePolicyCeiling ceiling = ceilingOf(10, 10); // window <= 100, cool/recover <= 20

        @Test
        @DisplayName("상한 바로 위·바로 아래·정확히 상한인 window-size 를 주면 → 위만 거부하고 나머지는 통과한다")
        void windowSizeIsBoundedInclusively() {
            assertThatCode(() -> ceiling.check(new EnginePolicy(99, 2, 2, TTL, 6, 1.0)))
                    .doesNotThrowAnyException();
            assertThatCode(() -> ceiling.check(new EnginePolicy(100, 2, 2, TTL, 6, 1.0)))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> ceiling.check(new EnginePolicy(101, 2, 2, TTL, 6, 1.0)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("window-size");
        }

        @Test
        @DisplayName("상한과 하한 사이의 평범한 값이면 → 통과한다(양 끝만 통과시키는 구현을 걸러낸다)")
        void anOrdinaryValueInBetweenPasses() {
            assertThatCode(() -> ceiling.check(new EnginePolicy(37, 5, 4, Duration.ofSeconds(90), 8, 2.0)))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("cool-after 가 상한을 넘으면 → cool-after 를 지목하며 거부한다")
        void coolAfterIsBounded() {
            assertThatThrownBy(() -> ceiling.check(new EnginePolicy(10, 21, 2, TTL, 6, 1.0)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("cool-after");
        }

        @Test
        @DisplayName("recover-after 가 상한을 넘으면 → recover-after 를 지목하며 거부한다")
        void recoverAfterIsBounded() {
            assertThatThrownBy(() -> ceiling.check(new EnginePolicy(10, 2, 21, TTL, 6, 1.0)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("recover-after");
        }

        @Test
        @DisplayName("lease-ttl 이 상한(300초)을 넘으면 → lease-ttl 을 지목하며 거부한다")
        void leaseTtlIsBounded() {
            assertThatCode(() -> ceiling.check(new EnginePolicy(10, 2, 2, Duration.ofSeconds(300), 6, 1.0)))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> ceiling.check(new EnginePolicy(10, 2, 2, Duration.ofSeconds(301), 6, 1.0)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("lease-ttl");
        }

        @Test
        @DisplayName("exploration-floor 가 상한(10.0)을 넘으면 → exploration-floor 를 지목하며 거부한다")
        void explorationFloorIsBounded() {
            assertThatCode(() -> ceiling.check(new EnginePolicy(10, 2, 2, TTL, 6, 10.0)))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> ceiling.check(new EnginePolicy(10, 2, 2, TTL, 6, 10.5)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exploration-floor");
        }

        @Test
        @DisplayName("cooldown-max-exponent 가 잘린 상한을 넘으면 → 거부한다")
        void cooldownExponentIsBounded() {
            EnginePolicyCeiling tight = ceilingOf(10, 2); // 6 × 2 = 12

            assertThatCode(() -> tight.check(new EnginePolicy(10, 2, 2, TTL, 12, 1.0)))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> tight.check(new EnginePolicy(10, 2, 2, TTL, 13, 1.0)))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("cooldown-max-exponent");
        }

        @Test
        @DisplayName("인스턴스 기본 정책 자체는 → 어떤 배수에서도 항상 통과한다(운영자가 자기 기본값을 못 저장하는 일은 없다)")
        void theInstanceDefaultAlwaysFitsUnderItsOwnCeiling() {
            for (int multiple : new int[] {1, 2, 10, 1_000}) {
                ReputationPoolProperties properties = withMultiple(properties(10, 2, 2, 6, 1.0), multiple);
                EnginePolicy defaults = EnginePolicy.defaultsFrom(properties);

                assertThatCode(() -> EnginePolicyCeiling.from(properties).check(defaults))
                        .doesNotThrowAnyException();
            }
        }
    }
}
