package io.github.preagile.reputationpool.cloud.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import javax.sql.DataSource;
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
@WebMvcTest(controllers = {TenantController.class, AuthController.class})
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            // 32-byte secret: HS256 needs a 256-bit key.
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
class ControlPlaneSecurityTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Clocks {
        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);
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

    // Required only so SecurityConfiguration's ApiKeyManagementService bean can be constructed.
    @MockitoBean
    private DataSource dataSource;

    @Test
    void protectedEndpoint_withoutToken_is401() throws Exception {
        mvc.perform(get("/api/tenants")).andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpoint_withGarbageToken_is401() throws Exception {
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
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
    void login_withValidCredentials_returnsToken() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"s3cret-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"));
    }

    @Test
    void login_withWrongPassword_is401() throws Exception {
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }
}
