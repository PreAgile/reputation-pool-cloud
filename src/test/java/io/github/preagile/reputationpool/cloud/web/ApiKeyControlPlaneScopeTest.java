package io.github.preagile.reputationpool.cloud.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService.IssuedApiKey;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * ApiKeyController 스코프 회귀 슬라이스(issue #82): 토큰이 바인딩된 테넌트의 키만 발급/목록/폐기할 수 있고, 다른
 * 테넌트를 겨냥하면 존재 여부를 노출하지 않고 403 으로 fail-closed 한다. Docker-free 라 build 게이트에서 돈다.
 * 토큰 tenant 클레임은 {@code reputation-pool.admin.tenant=default} 이며, 경로의 tenantId 를 바꿔가며 검증한다.
 */
@WebMvcTest(controllers = ApiKeyController.class)
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
@DisplayName("ApiKeyControlPlaneScope: 키 발급/목록/폐기를 토큰 테넌트 스코프로 강제한다")
class ApiKeyControlPlaneScopeTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Clocks {
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
    private ApiKeyManagementService apiKeys;

    @MockitoBean
    private TenantRepository tenants;

    // Required only so SecurityConfiguration's ApiKeyManagementService bean can be constructed.
    @MockitoBean
    private javax.sql.DataSource dataSource;

    private String bearer() {
        return "Bearer "
                + tokenService
                        .issueToken("admin", "s3cret-password")
                        .orElseThrow()
                        .token();
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 다른 테넌트로 키 발급을 시도하면 → 403 으로 거부하고 발급 서비스를 호출하지 않는다")
    void issueForOtherTenant_is403() throws Exception {
        mvc.perform(post("/api/tenants/other/api-keys").header("Authorization", bearer()))
                .andExpect(status().isForbidden());
        verify(apiKeys, never()).issue(any(), any());
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 다른 테넌트의 키 목록을 조회하면 → 403 으로 거부한다")
    void listForOtherTenant_is403() throws Exception {
        mvc.perform(get("/api/tenants/other/api-keys").header("Authorization", bearer()))
                .andExpect(status().isForbidden());
        verify(apiKeys, never()).list(any());
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 다른 테넌트의 키 폐기를 시도하면 → 403 으로 거부한다")
    void revokeForOtherTenant_is403() throws Exception {
        mvc.perform(delete("/api/tenants/other/api-keys/some-key").header("Authorization", bearer()))
                .andExpect(status().isForbidden());
        verify(apiKeys, never()).revoke(any(), any());
    }

    @Test
    @DisplayName("존재하지 않는 타 테넌트를 겨냥해도 → 404 가 아니라 403 이다(존재 프로빙 차단)")
    void issueForUnknownOtherTenant_is403NotFound() throws Exception {
        when(tenants.findById("ghost")).thenReturn(Optional.empty());
        mvc.perform(post("/api/tenants/ghost/api-keys").header("Authorization", bearer()))
                .andExpect(status().isForbidden());
        // 스코프 검사가 존재 검사보다 먼저이므로 repository 는 건드리지 않는다.
        verify(tenants, never()).findById(any());
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 같은 테넌트로 키를 발급하면 → 201 로 정상 발급한다(해피패스 보존)")
    void issueForOwnTenant_is201() throws Exception {
        when(tenants.findById("default"))
                .thenReturn(Optional.of(new Tenant(
                        "default",
                        "default",
                        io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                        Instant.now())));
        when(apiKeys.issue("default", null))
                .thenReturn(new IssuedApiKey("id-1", "rp_rawtoken", null, "rp_rawtok", Instant.now()));
        mvc.perform(post("/api/tenants/default/api-keys").header("Authorization", bearer()))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 같은 테넌트의 키 목록을 조회하면 → 200 으로 반환한다(해피패스 보존)")
    void listForOwnTenant_is200() throws Exception {
        when(tenants.findById("default"))
                .thenReturn(Optional.of(new Tenant(
                        "default",
                        "default",
                        io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                        Instant.now())));
        when(apiKeys.list("default")).thenReturn(List.of());
        mvc.perform(get("/api/tenants/default/api-keys").header("Authorization", bearer()))
                .andExpect(status().isOk());
    }
}
