package io.github.preagile.reputationpool.cloud.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

@DisplayName("AdminTenant: 토큰의 tenant 클레임으로 쓰기 대상 테넌트를 fail-closed 로 스코프한다")
class AdminTenantTest {

    private static Jwt tokenBoundTo(String tenant) {
        return Jwt.withTokenValue("token")
                .header("alg", "HS256")
                .subject("admin")
                .claim(AdminTokenService.TENANT_CLAIM, tenant)
                .build();
    }

    @Nested
    @DisplayName("requireScope(jwt, targetTenant)")
    class RequireScope {

        @Test
        @DisplayName("대상 테넌트가 토큰 테넌트와 같으면 → 통과한다(예외 없음)")
        void sameTenant_passes() {
            Jwt jwt = tokenBoundTo("default");
            assertThatCode(() -> AdminTenant.requireScope(jwt, "default")).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("대상 테넌트가 토큰 테넌트와 다르면 → 403 으로 거부한다")
        void otherTenant_is403() {
            Jwt jwt = tokenBoundTo("default");
            assertThatThrownBy(() -> AdminTenant.requireScope(jwt, "other"))
                    .isInstanceOf(ResponseStatusException.class)
                    .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                    .isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("토큰에 tenant 클레임이 없으면 → 대상과 무관하게 403 으로 거부한다(fail-closed)")
        void missingClaim_is403() {
            Jwt jwt = Jwt.withTokenValue("token")
                    .header("alg", "HS256")
                    .subject("admin")
                    .build();
            assertThatThrownBy(() -> AdminTenant.requireScope(jwt, "default"))
                    .isInstanceOf(ResponseStatusException.class)
                    .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                    .isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        @DisplayName("불일치 거부 사유는 존재 비노출을 위해 generic 이다 → 'forbidden'")
        void otherTenant_reasonIsGeneric() {
            Jwt jwt = tokenBoundTo("default");
            assertThatThrownBy(() -> AdminTenant.requireScope(jwt, "other"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(((ResponseStatusException) e).getReason())
                            .isEqualTo("forbidden"));
        }
    }
}
