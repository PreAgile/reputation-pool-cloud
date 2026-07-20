package io.github.preagile.reputationpool.cloud.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Security slice test for the login brute-force filter (issue #28), Docker-free so it runs in the {@code
 * build} gate. Boots the web layer + the real {@link SecurityConfiguration} (so the real {@link
 * io.github.preagile.reputationpool.cloud.security.LoginThrottleFilter} sits in the chain) with a small
 * {@code max-attempts} so the block trips within a test, and proves: repeated failures earn a 429 with a
 * {@code Retry-After} header, the 429 body is generic (never reveals credential validity), and a
 * successful login resets the IP's counter.
 */
@WebMvcTest(controllers = {AuthController.class})
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            // Small window so a handful of attempts trips the block within the test.
            "reputation-pool.admin.login-throttle.max-attempts=3",
            "reputation-pool.admin.login-throttle.window=PT15M",
            "reputation-pool.admin.login-throttle.block-duration=PT15M",
            "reputation-pool.admin.login-throttle.global-max-per-second=1000"
        })
class LoginThrottleFilterTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Beans {
        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }

        @Bean
        MeterRegistry meterRegistry() {
            return new SimpleMeterRegistry();
        }
    }

    @Autowired
    private MockMvc mvc;

    // Required only so SecurityConfiguration's ApiKeyManagementService bean can be constructed.
    @MockitoBean
    private DataSource dataSource;

    @MockitoBean
    private TenantRepository tenants;

    @MockitoBean
    private TenantPoolRegistry registry;

    @MockitoBean
    private UsageMeterReader usageMeterReader;

    // The LoginThrottle bean is a singleton shared across methods in the cached context, so each test uses
    // a distinct source IP to stay isolated from another test's 15-minute block.
    private MockHttpServletRequestBuilder login(String ip, String password) {
        return post("/api/auth/login")
                .with(request -> {
                    request.setRemoteAddr(ip);
                    // MockMvc leaves servletPath empty; a real embedded Tomcat (DispatcherServlet mapped
                    // to "/") returns the in-context path. Set it so the filter's getServletPath() match
                    // mirrors runtime.
                    request.setServletPath("/api/auth/login");
                    return request;
                })
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"" + password + "\"}");
    }

    @Test
    void repeatedFailures_areBlockedWith429AndRetryAfter() throws Exception {
        String ip = "203.0.113.1";
        // max-attempts=3: three failing logins arm the block, the fourth request is throttled.
        for (int i = 0; i < 3; i++) {
            mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());
        }

        mvc.perform(login(ip, "wrong"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"));
    }

    @Test
    void throttledResponse_isGeneric_andDoesNotLeakCredentials() throws Exception {
        String ip = "203.0.113.2";
        for (int i = 0; i < 3; i++) {
            mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());
        }

        mvc.perform(login(ip, "wrong"))
                .andExpect(status().isTooManyRequests())
                // Generic message only — never "invalid credentials" or any hint about the account.
                .andExpect(jsonPath("$.detail").value("로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."))
                .andExpect(jsonPath("$.status").value(429));
    }

    @Test
    void successfulLogin_resetsCounter() throws Exception {
        String ip = "203.0.113.3";
        // Two failures, then a success clears the counter, so two more failures still stay under the limit.
        mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());
        mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());

        mvc.perform(login(ip, "s3cret-password")).andExpect(status().isOk());

        mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());
        // Without the reset this fourth cumulative failure would already be a 429.
        mvc.perform(login(ip, "wrong")).andExpect(status().isUnauthorized());
    }
}
