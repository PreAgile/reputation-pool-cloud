package io.github.preagile.reputationpool.cloud.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventPage;
import io.github.preagile.reputationpool.cloud.readmodel.ScoreHistoryReader;
import io.github.preagile.reputationpool.cloud.readmodel.ScoreHistoryReader.ScoreHistory;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader.UsageSummary;
import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService.IssuedApiKey;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantLifecycleService;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * The contract that makes a demo login safe to hand out (issue #31): a read-only token may see
 * everything and change nothing, while the full-power token behaves exactly as it did before.
 *
 * <p>Every mutating control-plane endpoint that exists is listed in {@link #writeEndpoints()} and driven
 * twice — once with each token. That list is the audit: if an endpoint is missing from it the test says
 * nothing about that endpoint, which is precisely why enforcement lives in one method-based filter rather
 * than in per-endpoint checks (see {@code AdminWriteAuthorizationFilter}). The final case here pins that
 * property directly by inventing an endpoint that does not exist.
 *
 * <p>Both accounts are bound to the same tenant on purpose, so the only difference between the two runs
 * is the role — a 403 cannot be mistaken for the pre-existing cross-tenant scope check.
 */
@WebMvcTest(
        controllers = {
            TenantController.class,
            ApiKeyController.class,
            PoolController.class,
            EventController.class,
            UsageController.class,
            AuthController.class
        })
@Import(SecurityConfiguration.class)
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=operator",
            "reputation-pool.admin.password=operator-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.accounts[0].username=observer",
            "reputation-pool.admin.accounts[0].password=observer-password",
            "reputation-pool.admin.accounts[0].tenant=default",
            "reputation-pool.admin.accounts[0].role=read-only",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
@DisplayName("ReadOnlyRoleControlPlane: 읽기 전용 토큰은 모든 쓰기 엔드포인트에서 403, 전권 토큰은 그대로 동작하는 역할 계약")
class ReadOnlyRoleControlPlaneTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Beans {
        // Real clock: the token's exp is stamped from it and validated against system time by the decoder.
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

    @Autowired
    private AdminTokenService tokenService;

    @MockitoBean
    private TenantRepository tenants;

    @MockitoBean
    private TenantPoolRegistry registry;

    @MockitoBean
    private TenantLifecycleService lifecycle;

    @MockitoBean
    private ApiKeyManagementService apiKeys;

    @MockitoBean
    private AuditEventReader auditEvents;

    @MockitoBean
    private UsageMeterReader usageMeters;

    @MockitoBean
    private ScoreHistoryReader scoreHistory;

    /** Only needed so SecurityConfiguration's own ApiKeyManagementService bean can be constructed. */
    @MockitoBean
    private DataSource dataSource;

    /**
     * A real pool rather than a mock: {@code ResourcePool} is final, and the block/unblock endpoints are
     * only interesting if a successful call actually reaches something that records the change.
     */
    private final ResourcePool pool = new ResourcePool(
            new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
            new WeightedRandomSelectionStrategy(),
            event -> {},
            Clock.systemUTC(),
            new Random(1),
            Duration.ofSeconds(30));

    @BeforeEach
    void stubHappyPath() {
        // TenantStatusFilter checks the calling token's own tenant on every authenticated request.
        when(tenants.findById("default"))
                .thenReturn(Optional.of(new Tenant("default", "default", TenantStatus.ACTIVE, Instant.now())));
        when(tenants.findAll()).thenReturn(List.of());
        when(registry.poolFor(anyString())).thenReturn(pool);
        when(apiKeys.issue(anyString(), any()))
                .thenReturn(new IssuedApiKey("key-1", "rp_raw", "label", "rp_ra", Instant.now()));
        when(apiKeys.revoke(anyString(), anyString())).thenReturn(true);
        when(auditEvents.page(anyString(), any(), org.mockito.ArgumentMatchers.anyInt()))
                .thenReturn(new AuditEventPage(List.of(), null, false));
        when(usageMeters.read(anyString(), any())).thenReturn(new UsageSummary(0, 0, List.of()));
        when(scoreHistory.read(anyString(), any(), any())).thenReturn(new ScoreHistory(List.of()));
    }

    /**
     * Every mutating endpoint the control plane exposes, enumerated from the {@code @PostMapping} /
     * {@code @DeleteMapping} declarations across {@code web/}. {@code POST /api/auth/login} is
     * deliberately absent: it is the public, unauthenticated endpoint a read-only account uses to obtain
     * its token in the first place, and is covered separately below.
     */
    static Stream<Arguments> writeEndpoints() {
        return Stream.of(
                Arguments.of("테넌트 생성", HttpMethod.POST, "/api/tenants", "{\"id\":\"whatever\"}"),
                Arguments.of("테넌트 정지", HttpMethod.POST, "/api/tenants/default/suspend", null),
                Arguments.of("테넌트 재개", HttpMethod.POST, "/api/tenants/default/reactivate", null),
                Arguments.of("테넌트 삭제", HttpMethod.DELETE, "/api/tenants/default", null),
                Arguments.of("API 키 발급", HttpMethod.POST, "/api/tenants/default/api-keys", "{\"label\":\"x\"}"),
                Arguments.of("API 키 폐기", HttpMethod.DELETE, "/api/tenants/default/api-keys/key-1", null),
                Arguments.of("리소스 차단", HttpMethod.POST, "/api/pools/resources/proxy/p-01/block?permanent=true", null),
                Arguments.of("리소스 차단 해제", HttpMethod.DELETE, "/api/pools/resources/proxy/p-01/block", null));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("writeEndpoints")
    @DisplayName("읽기 전용 토큰으로 쓰기 엔드포인트를 호출하면 → 전부 403 으로 거부한다")
    void readOnlyToken_isForbiddenOnEveryWrite(String name, HttpMethod method, String path, String body)
            throws Exception {
        mvc.perform(authorized(request(method, path, body), readOnlyToken())).andExpect(status().isForbidden());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("writeEndpoints")
    @DisplayName("전권 토큰으로 같은 쓰기 엔드포인트를 호출하면 → 역할 때문에 막히지 않는다(기존 동작 유지)")
    void adminToken_isNotForbiddenOnAnyWrite(String name, HttpMethod method, String path, String body)
            throws Exception {
        int status = mvc.perform(authorized(request(method, path, body), adminToken()))
                .andReturn()
                .getResponse()
                .getStatus();

        assertThat(status).isNotEqualTo(403);
    }

    @Test
    @DisplayName("읽기 전용 토큰이 쓰기로 거부되면 → 컨트롤러·서비스에는 아예 닿지 않는다(필터에서 끊긴다)")
    void readOnlyWriteNeverReachesTheService() throws Exception {
        mvc.perform(authorized(MockMvcRequestBuilders.delete("/api/tenants/default"), readOnlyToken()))
                .andExpect(status().isForbidden());

        verifyNoInteractions(lifecycle);
        verify(tenants, never()).create(any());
    }

    @Test
    @DisplayName("읽기 전용 토큰으로 대시보드 조회(개요·이벤트·사용량·자기 테넌트)를 호출하면 → 모두 200 이다")
    void readOnlyTokenCanRead() throws Exception {
        String token = readOnlyToken();
        for (String path :
                List.of("/api/pools/resources", "/api/events?limit=10", "/api/usage", "/api/tenants/default")) {
            mvc.perform(authorized(get(path), token)).andExpect(status().isOk());
        }
    }

    @Test
    @DisplayName("읽기 전용 계정도 자기 토큰을 받아야 하므로 → 공개 엔드포인트인 로그인은 역할 게이트가 막지 않는다")
    void loginIsNotBlocked() throws Exception {
        mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"observer\",\"password\":\"observer-password\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("role 클레임이 없는(이 기능 이전에 발급된) 토큰으로 쓰기를 시도하면 → 403 으로 닫는다")
    void tokenWithoutRoleClaimCannotWrite() throws Exception {
        mvc.perform(authorized(MockMvcRequestBuilders.delete("/api/tenants/default"), roleLessToken()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("role 클레임이 없는 토큰이라도 → 읽기는 그대로 허용된다(기존 조회가 401/403 으로 죽지 않는다)")
    void tokenWithoutRoleClaimCanStillRead() throws Exception {
        mvc.perform(authorized(get("/api/pools/resources"), roleLessToken())).andExpect(status().isOk());
    }

    @Test
    @DisplayName("존재하지 않는 경로에 쓰기를 보내도 → 읽기 전용 토큰은 404 가 아니라 403 을 받는다(엔드포인트 목록이 아니라 메서드로 막는다)")
    void unknownWritePathIsAlsoForbidden() throws Exception {
        mvc.perform(authorized(MockMvcRequestBuilders.post("/api/some-endpoint-added-tomorrow"), readOnlyToken()))
                .andExpect(status().isForbidden());
    }

    private static MockHttpServletRequestBuilder request(HttpMethod method, String path, String body) {
        MockHttpServletRequestBuilder builder = MockMvcRequestBuilders.request(method, java.net.URI.create(path));
        return body == null
                ? builder
                : builder.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder builder, String token) {
        return builder.header("Authorization", "Bearer " + token);
    }

    private String adminToken() {
        return tokenService
                .issueToken("operator", "operator-password")
                .orElseThrow()
                .token();
    }

    private String readOnlyToken() {
        return tokenService
                .issueToken("observer", "observer-password")
                .orElseThrow()
                .token();
    }

    /**
     * A validly signed token that carries no {@code role} claim — what every token minted before this
     * feature shipped looks like, and the shape the gate must refuse writes for.
     */
    @Autowired
    private org.springframework.security.oauth2.jwt.JwtEncoder encoder;

    private String roleLessToken() {
        Instant now = Instant.now();
        return encoder.encode(org.springframework.security.oauth2.jwt.JwtEncoderParameters.from(
                        org.springframework.security.oauth2.jwt.JwsHeader.with(
                                        org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256)
                                .build(),
                        org.springframework.security.oauth2.jwt.JwtClaimsSet.builder()
                                .issuer("reputation-pool-cloud")
                                .issuedAt(now)
                                .expiresAt(now.plus(Duration.ofHours(1)))
                                .subject("legacy")
                                .claim(AdminTokenService.TENANT_CLAIM, "default")
                                .build()))
                .getTokenValue();
    }
}
