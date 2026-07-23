package io.github.preagile.reputationpool.cloud.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import java.time.Clock;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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
 * Security slice test for the control plane (issue #11), Docker-free so it runs in the {@code build}
 * gate. Boots just the web layer + the real {@link SecurityConfiguration} (real HS256 encode/decode
 * over a test secret) and mocks the data access, proving the auth contract end to end: no token → 401,
 * a garbage token → 401, and a token minted by the real login → 200. It also proves login rejects bad
 * credentials with a bare 401.
 */
@WebMvcTest(controllers = {TenantController.class, AuthController.class, UsageController.class})
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            // 32-byte secret: HS256 needs a 256-bit key.
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
@DisplayName("ControlPlaneSecurity: 토큰 없으면 401, 유효 토큰이면 200 으로 API 접근을 통제하는 인증 계약")
class ControlPlaneSecurityTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Clocks {
        // Real clock, not a fixed one: AdminTokenService now stamps the JWT's iat/exp from this clock,
        // while the NimbusJwtDecoder validates exp against system time. A fixed past instant would mint a
        // token that is already expired by the decoder's wall clock, so the auth round trip must use the
        // real clock. This slice asserts only status codes, never timestamps, so determinism is not needed.
        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }

        // SecurityConfiguration's LoginThrottleFilter (issue #28) needs a MeterRegistry; the web slice does
        // not auto-configure one, so supply a simple in-memory registry.
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
    private io.github.preagile.reputationpool.cloud.tenant.TenantLifecycleService tenantLifecycleService;

    // Required only so SecurityConfiguration's ApiKeyManagementService bean can be constructed.
    @MockitoBean
    private DataSource dataSource;

    // Required so UsageController can be constructed in the slice.
    @MockitoBean
    private UsageMeterReader usageMeterReader;

    @Test
    @DisplayName("토큰 없이 /api/tenants 를 호출하면 → 401 로 거부한다")
    void protectedEndpoint_withoutToken_is401() throws Exception {
        mvc.perform(get("/api/tenants")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("토큰 없이 /api/usage 를 호출하면 → 401 로 거부한다")
    void usageEndpoint_withoutToken_is401() throws Exception {
        mvc.perform(get("/api/usage")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("위조된(디코딩 불가) 토큰으로 호출하면 → 401 로 거부한다")
    void protectedEndpoint_withGarbageToken_is401() throws Exception {
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("실제 로그인으로 발급된 유효 토큰으로 호출하면 → 200 으로 허용한다")
    void protectedEndpoint_withValidToken_is200() throws Exception {
        org.mockito.Mockito.when(tenants.findAll()).thenReturn(List.of());
        String token = tokenService
                .issueToken("admin", "s3cret-password")
                .orElseThrow()
                .token();

        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("올바른 자격증명이면 → 200 과 함께 비어있지 않은 Bearer 타입 토큰을 발급한다")
    void login_withValidCredentials_returnsToken() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"s3cret-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"));
    }

    @Test
    @DisplayName("비밀번호가 틀리면 → 401 로 거부한다")
    void login_withWrongPassword_is401() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("자기 테넌트(default) 단건 조회는 → 200 으로 허용한다")
    void getOwnTenant_is200() throws Exception {
        org.mockito.Mockito.when(tenants.findById("default"))
                .thenReturn(java.util.Optional.of(new io.github.preagile.reputationpool.cloud.tenant.Tenant(
                        "default",
                        "default",
                        io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                        java.time.Instant.now())));
        String token = tokenService
                .issueToken("admin", "s3cret-password")
                .orElseThrow()
                .token();

        mvc.perform(get("/api/tenants/default").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("다른 테넌트 단건 조회는 → 404 가 아니라 403 으로 거부한다(존재 비노출)")
    void getOtherTenant_is403() throws Exception {
        String token = tokenService
                .issueToken("admin", "s3cret-password")
                .orElseThrow()
                .token();

        mvc.perform(get("/api/tenants/other").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        // 스코프 검사가 존재 검사보다 먼저이므로 repository 는 건드리지 않는다.
        org.mockito.Mockito.verify(tenants, org.mockito.Mockito.never()).findById(org.mockito.ArgumentMatchers.any());
    }
}
