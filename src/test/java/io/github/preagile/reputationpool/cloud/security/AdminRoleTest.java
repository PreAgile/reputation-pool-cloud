package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("AdminRole: 토큰의 role 클레임을 권한으로 해석하는 역할 값 — 모르는 값은 권한 없음으로 닫는다")
class AdminRoleTest {

    @Test
    @DisplayName("admin 역할이면 → 쓰기 권한이 있고, read-only 역할이면 → 쓰기 권한이 없다")
    void writeAuthority() {
        assertThat(AdminRole.ADMIN.canWrite()).isTrue();
        assertThat(AdminRole.READ_ONLY.canWrite()).isFalse();
    }

    @Test
    @DisplayName("역할을 클레임 문자열로 내보내면 → 설정에 쓰는 표기(admin·read-only)와 같은 값이 되고 되읽을 수 있다")
    void claimValueRoundTrips() {
        for (AdminRole role : AdminRole.values()) {
            assertThat(AdminRole.fromClaim(role.claimValue())).contains(role);
        }
        assertThat(AdminRole.ADMIN.claimValue()).isEqualTo("admin");
        assertThat(AdminRole.READ_ONLY.claimValue()).isEqualTo("read-only");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", "ADMIN", "readonly", "root", "superuser", "read_only"})
    @DisplayName("클레임이 없거나 비었거나 모르는 값이면 → 어떤 역할로도 해석하지 않는다(기본값으로 승격하지 않음)")
    void unknownClaimResolvesToNothing(String claim) {
        assertThat(AdminRole.fromClaim(claim)).isEmpty();
    }
}
