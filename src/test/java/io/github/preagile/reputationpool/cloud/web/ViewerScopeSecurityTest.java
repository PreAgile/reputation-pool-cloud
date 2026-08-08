package io.github.preagile.reputationpool.cloud.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantLifecycleService;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The read-only viewer login (the credential published as a demo account on a CV). Proves the property
 * that makes publishing it defensible: a viewer token reads everything the console shows and cannot
 * change anything, enforced at the filter chain rather than by the dashboard hiding controls.
 *
 * <p>The write endpoints exercised here are the three that actually destroy value — tenant creation,
 * tenant deletion, and (in {@link ControlPlaneSecurityTest}'s sibling surface) API-key issuance. The
 * deletion case matters most: {@code DELETE /api/tenants/{id}} hard-deletes scoped data, so a published
 * credential reaching it would be the whole risk of having a demo account at all.
 */
@WebMvcTest(controllers = {TenantController.class, AuthController.class, UsageController.class})
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.viewer-username=viewer",
            "reputation-pool.admin.viewer-password=viewer-password",
            "reputation-pool.admin.tenant=default",
            // 32-byte secret: HS256 needs a 256-bit key.
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
@DisplayName("ViewerScope: 공개된 열람용 계정은 모든 조회를 하되 어떤 쓰기도 못 한다")
class ViewerScopeSecurityTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Clocks {
        // Real clock: the token's exp is validated by the decoder against system time (see the same note
        // in ControlPlaneSecurityTest). This slice asserts status codes only, so determinism is not needed.
        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }

        @Bean
        io.micrometer.core.instrument.MeterRegistry meterRegistry() {
            return new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        }
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private AdminTokenService tokenService;

    @MockitoBean
    private TenantRepository tenants;

    @MockitoBean
    private TenantPoolRegistry registry;

    @MockitoBean
    private TenantLifecycleService lifecycle;

    @MockitoBean
    private DataSource dataSource;

    @MockitoBean
    private UsageMeterReader usageMeterReader;

    @BeforeEach
    void tenantIsActive() {
        // TenantStatusFilter(#83) checks the calling token's tenant on every authenticated request; without
        // this stub every case would 403 at the filter and prove nothing about scope.
        Mockito.when(tenants.findById("default"))
                .thenReturn(Optional.of(new Tenant("default", "default", TenantStatus.ACTIVE, Instant.now())));
        Mockito.when(tenants.findAll()).thenReturn(List.of());
    }

    private String viewerToken() {
        return tokenService
                .issueToken("viewer", "viewer-password")
                .orElseThrow()
                .token();
    }

    private String adminToken() {
        return tokenService.issueToken("admin", "s3cret-password").orElseThrow().token();
    }

    @Test
    @DisplayName("뷰어 자격증명으로 로그인하면 → 200 과 scope=viewer 토큰을 발급한다")
    void viewerLogin_returnsViewerScopedToken() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"viewer\",\"password\":\"viewer-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.scope").value("viewer"));
    }

    @Test
    @DisplayName("어드민 자격증명으로 로그인하면 → scope=admin 토큰을 발급한다")
    void adminLogin_returnsAdminScopedToken() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"s3cret-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("admin"));
    }

    @Test
    @DisplayName("뷰어 비밀번호가 틀리면 → 401 로 거부한다")
    void viewerLogin_withWrongPassword_is401() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"viewer\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("뷰어 토큰으로 목록 조회(GET /api/tenants)는 → 200 으로 허용한다")
    void viewerToken_canRead() throws Exception {
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + viewerToken()))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("뷰어 토큰으로 사용량 조회(GET /api/usage)는 → 200 으로 허용한다")
    void viewerToken_canReadUsage() throws Exception {
        mvc.perform(get("/api/usage").header("Authorization", "Bearer " + viewerToken()))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("뷰어 토큰으로 테넌트 생성(POST)을 시도하면 → 403, 서비스는 호출조차 되지 않는다")
    void viewerToken_cannotCreateTenant() throws Exception {
        mvc.perform(post("/api/tenants")
                        .header("Authorization", "Bearer " + viewerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"intruder\",\"name\":\"intruder\"}"))
                .andExpect(status().isForbidden());
        Mockito.verify(registry, Mockito.never()).onboard(Mockito.anyString());
    }

    @Test
    @DisplayName("뷰어 토큰으로 테넌트 삭제(DELETE)를 시도하면 → 403, 삭제는 실행되지 않는다")
    void viewerToken_cannotDeleteTenant() throws Exception {
        mvc.perform(delete("/api/tenants/default").header("Authorization", "Bearer " + viewerToken()))
                .andExpect(status().isForbidden());
        Mockito.verify(lifecycle, Mockito.never()).delete(Mockito.anyString());
    }

    @Test
    @DisplayName("뷰어 토큰으로 테넌트 정지(POST /suspend)를 시도하면 → 403 으로 거부한다")
    void viewerToken_cannotSuspendTenant() throws Exception {
        mvc.perform(post("/api/tenants/default/suspend").header("Authorization", "Bearer " + viewerToken()))
                .andExpect(status().isForbidden());
        Mockito.verify(lifecycle, Mockito.never()).suspend(Mockito.anyString());
    }

    @Test
    @DisplayName("같은 삭제 요청이 어드민 토큰이면 → 통과한다(막는 것은 스코프이지 엔드포인트가 아님)")
    void adminToken_canDeleteTenant() throws Exception {
        mvc.perform(delete("/api/tenants/default").header("Authorization", "Bearer " + adminToken()))
                .andExpect(status().isNoContent());
        Mockito.verify(lifecycle).delete("default");
    }

    @Test
    @DisplayName("뷰어 토큰은 scope 클레임이 viewer 하나뿐이다(admin 권한이 섞여 들어오지 않는다)")
    void viewerToken_carriesOnlyViewerScope() {
        AdminTokenService.IssuedToken issued =
                tokenService.issueToken("viewer", "viewer-password").orElseThrow();
        assertThat(issued.scope()).isEqualTo(AdminTokenService.SCOPE_VIEWER);
    }
}
