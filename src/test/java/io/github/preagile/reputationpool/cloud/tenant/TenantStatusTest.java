package io.github.preagile.reputationpool.cloud.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * {@link TenantStatus} 상태기(state machine) 단위 테스트. 합법/불법 전이 매트릭스를 못박아, 라이프사이클
 * 서비스가 잘못된 전이를 409 로 거절하는 근거가 되는 규칙을 회귀로 보호한다.
 */
@DisplayName("TenantStatus: 테넌트 라이프사이클 상태 전이 규칙")
class TenantStatusTest {

    @Nested
    @DisplayName("ACTIVE 에서는")
    class FromActive {
        @Test
        @DisplayName("SUSPENDED 로 전이하면 → 허용한다")
        void toSuspended_isAllowed() {
            assertThat(TenantStatus.ACTIVE.canTransitionTo(TenantStatus.SUSPENDED))
                    .isTrue();
        }

        @Test
        @DisplayName("DELETED 로 전이하면 → 허용한다")
        void toDeleted_isAllowed() {
            assertThat(TenantStatus.ACTIVE.canTransitionTo(TenantStatus.DELETED))
                    .isTrue();
        }

        @Test
        @DisplayName("같은 ACTIVE 로 전이하면 → 거절한다(무의미한 자기 전이)")
        void toActive_isRejected() {
            assertThat(TenantStatus.ACTIVE.canTransitionTo(TenantStatus.ACTIVE)).isFalse();
        }
    }

    @Nested
    @DisplayName("SUSPENDED 에서는")
    class FromSuspended {
        @Test
        @DisplayName("ACTIVE 로 재활성화하면 → 허용한다")
        void toActive_isAllowed() {
            assertThat(TenantStatus.SUSPENDED.canTransitionTo(TenantStatus.ACTIVE))
                    .isTrue();
        }

        @Test
        @DisplayName("DELETED 로 전이하면 → 허용한다")
        void toDeleted_isAllowed() {
            assertThat(TenantStatus.SUSPENDED.canTransitionTo(TenantStatus.DELETED))
                    .isTrue();
        }

        @Test
        @DisplayName("같은 SUSPENDED 로 전이하면 → 거절한다")
        void toSuspended_isRejected() {
            assertThat(TenantStatus.SUSPENDED.canTransitionTo(TenantStatus.SUSPENDED))
                    .isFalse();
        }
    }

    @Nested
    @DisplayName("DELETED 에서는(최종 상태)")
    class FromDeleted {
        @Test
        @DisplayName("ACTIVE 로 되살리려 하면 → 거절한다")
        void toActive_isRejected() {
            assertThat(TenantStatus.DELETED.canTransitionTo(TenantStatus.ACTIVE))
                    .isFalse();
        }

        @Test
        @DisplayName("SUSPENDED 로 전이하려 하면 → 거절한다")
        void toSuspended_isRejected() {
            assertThat(TenantStatus.DELETED.canTransitionTo(TenantStatus.SUSPENDED))
                    .isFalse();
        }

        @Test
        @DisplayName("DELETED 로 다시 전이하려 하면 → 거절한다")
        void toDeleted_isRejected() {
            assertThat(TenantStatus.DELETED.canTransitionTo(TenantStatus.DELETED))
                    .isFalse();
        }
    }
}
