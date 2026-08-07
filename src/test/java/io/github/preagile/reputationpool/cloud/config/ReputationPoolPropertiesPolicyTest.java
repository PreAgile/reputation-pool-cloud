package io.github.preagile.reputationpool.cloud.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Fail-fast validation of the two records per-tenant policy rests on (issue #179), in the same posture
 * as {@link ReputationPoolProperties.Limits}. Spring instantiates both during property binding, so an
 * invalid value aborts the boot rather than surfacing at the first tenant's lazily built pool.
 *
 * <p>{@link ReputationPoolProperties.Engine} matters twice over now: it is what a tenant without a
 * stored policy runs, <em>and</em> it is what every ceiling is derived from — an out-of-range default
 * would produce an out-of-range ceiling.
 */
@DisplayName("ReputationPoolProperties: 엔진 기본값과 정책 상한 배수를 부팅 시점에 검증하는 설정 레코드")
class ReputationPoolPropertiesPolicyTest {

    @Nested
    @DisplayName("Engine — 인스턴스의 엔진 기본값")
    class Engine {

        @Test
        @DisplayName("upstream 기본값(10·2·2·6·1.0)이면 → 정상 생성된다")
        void acceptsTheReferenceDefaults() {
            assertThatCode(() -> new ReputationPoolProperties.Engine(10, 2, 2, 6, 1.0))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("임계값이 1 이면 허용하고 0 이면 → 그 항목을 지목하며 거부한다")
        void thresholdsAreBoundedBelowAtOne() {
            assertThatCode(() -> new ReputationPoolProperties.Engine(1, 1, 1, 6, 1.0))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(0, 2, 2, 6, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.window-size");
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 0, 2, 6, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.cool-after");
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 2, 0, 6, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.recover-after");
        }

        @Test
        @DisplayName("cooldown-max-exponent 가 upstream 허용 범위를 벗어나면 → 거부한다")
        void theCooldownExponentFollowsTheUpstreamRange() {
            assertThatCode(() -> new ReputationPoolProperties.Engine(
                            10, 2, 2, AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT, 1.0))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(
                            10, 2, 2, AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT + 1, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.cooldown-max-exponent");
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 2, 2, -1, 1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.cooldown-max-exponent");
        }

        @Test
        @DisplayName("exploration-floor 가 0·음수·NaN 이면 → 거부한다")
        void theExplorationFloorMustBeFiniteAndPositive() {
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 2, 2, 6, 0.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.exploration-floor");
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 2, 2, 6, -1.0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.exploration-floor");
            assertThatThrownBy(() -> new ReputationPoolProperties.Engine(10, 2, 2, 6, Double.NaN))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("engine.exploration-floor");
        }
    }

    @Nested
    @DisplayName("PolicyCeiling — 테넌트 정책이 기본값에서 벗어날 수 있는 배수")
    class PolicyCeiling {

        @Test
        @DisplayName("1·중간값·최대 배수면 → 모두 허용한다")
        void acceptsTheWholeSupportedRange() {
            assertThatCode(() -> new ReputationPoolProperties.PolicyCeiling(1)).doesNotThrowAnyException();
            assertThatCode(() -> new ReputationPoolProperties.PolicyCeiling(10)).doesNotThrowAnyException();
            assertThatCode(() -> new ReputationPoolProperties.PolicyCeiling(
                            ReputationPoolProperties.PolicyCeiling.MAX_MULTIPLE))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("0 이면 → 거부한다(상한이 인스턴스 기본값 아래로 내려가 자기 기본값조차 저장할 수 없게 된다)")
        void rejectsZero() {
            assertThatThrownBy(() -> new ReputationPoolProperties.PolicyCeiling(0))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("policy-ceiling.max-multiple-of-default");
        }

        @Test
        @DisplayName("최대 배수를 1 넘기면 → 거부한다(상한을 사실상 꺼 버리는 값이다)")
        void rejectsOneAboveTheMaximum() {
            assertThatThrownBy(() -> new ReputationPoolProperties.PolicyCeiling(
                            ReputationPoolProperties.PolicyCeiling.MAX_MULTIPLE + 1))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("policy-ceiling.max-multiple-of-default");
        }
    }
}
