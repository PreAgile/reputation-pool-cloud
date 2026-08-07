package io.github.preagile.reputationpool.cloud.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicy;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyCeiling;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyConflictException;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyRepository;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyRevision;
import io.github.preagile.reputationpool.cloud.policy.StoredEnginePolicySource;
import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.security.SecurityConfiguration;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
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
 * The control-plane half of per-tenant engine policy (issue #179), as a Docker-free slice so it runs on
 * the {@code build} gate.
 *
 * <p>Two things are pinned here. First, the tenant boundary: like every other tenant-scoped endpoint,
 * the scope check runs before any existence check, so aiming at another tenant is a 403 whether or not
 * it exists (issue #82). Second, <em>when</em> an invalid policy is refused — the entire reason
 * {@code EnginePolicy} validates in its constructor is that the upstream engine would otherwise reject
 * the same value at pool-build time, long after the request that stored it, as a 500 on some later gRPC
 * call. These tests assert the 400.
 */
@WebMvcTest(controllers = EnginePolicyController.class)
@Import({SecurityConfiguration.class, EnginePolicyControlPlaneTest.Beans.class})
@TestPropertySource(
        properties = {
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef"
        })
@DisplayName("EnginePolicyControlPlane: 테넌트 엔진 정책 조회·저장을 스코프와 값 범위로 강제한다")
class EnginePolicyControlPlaneTest {

    // Fixed for determinism, but anchored to the current time: the admin token this test mints carries a
    // real expiry, and Spring Security's JWT decoder checks it against the wall clock — a hard-coded
    // instant would make every request 401 the moment it drifts out of the token TTL.
    private static final Instant NOW = Instant.now();

    /** window <= 100, cool/recover <= 20, lease-ttl <= PT5M, exploration-floor <= 10.0. */
    private static final ReputationPoolProperties PROPERTIES = new ReputationPoolProperties(
            Duration.ofSeconds(30),
            Duration.ofSeconds(30),
            new ReputationPoolProperties.Engine(10, 2, 2, 6, 1.0),
            new ReputationPoolProperties.Audit(Duration.ofHours(1), Duration.ZERO),
            new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
            new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)),
            new ReputationPoolProperties.Limits(100_000, 500_000),
            new ReputationPoolProperties.SurgeThresholds(10, 1),
            new ReputationPoolProperties.PolicyCeiling(10));

    @TestConfiguration(proxyBeanMethods = false)
    public static class Beans {
        @Bean
        Clock clock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }

        @Bean
        io.micrometer.core.instrument.MeterRegistry meterRegistry() {
            return new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        }

        @Bean
        EnginePolicyCeiling enginePolicyCeiling() {
            return EnginePolicyCeiling.from(PROPERTIES);
        }

        @Bean
        StoredEnginePolicySource enginePolicySource(EnginePolicyRepository repository) {
            return new StoredEnginePolicySource(repository, EnginePolicy.defaultsFrom(PROPERTIES));
        }
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private AdminTokenService tokenService;

    @MockitoBean
    private EnginePolicyRepository policies;

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

    /**
     * TenantStatusFilter(#83)가 인증된 요청마다 호출 토큰(default)의 상태를 확인하므로, 그 필터가 아니라
     * 컨트롤러 로직을 검증하도록 default 를 active 로 스텁해 통과시킨다.
     */
    private void callerTenantIsActive() {
        when(tenants.findById("default"))
                .thenReturn(Optional.of(new Tenant("default", "default", TenantStatus.ACTIVE, NOW)));
    }

    private static String body(String windowSize, String coolAfter, String leaseTtl, String explorationFloor) {
        return """
                {"windowSize": %s, "coolAfter": %s, "recoverAfter": 2, "leaseTtl": %s,
                 "cooldownMaxExponent": 6, "explorationFloor": %s}""".formatted(windowSize, coolAfter, leaseTtl, explorationFloor);
    }

    private static String validBody() {
        return body("20", "3", "\"PT45S\"", "1.5");
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 다른 테넌트의 정책을 저장하려 하면 → 403 이고 저장소를 건드리지 않는다")
    void writeForOtherTenant_is403() throws Exception {
        callerTenantIsActive();

        mvc.perform(put("/api/tenants/other/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isForbidden());

        verify(policies, never()).append(any(), any(), any(), any());
    }

    @Test
    @DisplayName("다른 테넌트의 정책을 조회하면 → 403 이다")
    void readForOtherTenant_is403() throws Exception {
        callerTenantIsActive();

        mvc.perform(get("/api/tenants/other/engine-policy").header("Authorization", bearer()))
                .andExpect(status().isForbidden());

        verify(policies, never()).findCurrent(any());
    }

    @Test
    @DisplayName("존재하지 않는 타 테넌트를 겨냥해도 → 404 가 아니라 403 이고 그 id 를 조회조차 하지 않는다(존재 프로빙 차단)")
    void unknownOtherTenant_is403NotFound() throws Exception {
        callerTenantIsActive();
        when(tenants.findById("ghost")).thenReturn(Optional.empty());

        mvc.perform(get("/api/tenants/ghost/engine-policy").header("Authorization", bearer()))
                .andExpect(status().isForbidden());

        verify(tenants, never()).findById("ghost");
    }

    @Test
    @DisplayName("토큰 없이 호출하면 → 401 이다")
    void withoutAToken_is401() throws Exception {
        mvc.perform(get("/api/tenants/default/engine-policy")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("정책을 저장한 적이 없으면 → 인스턴스 기본값을 source=instance-default 로 돌려준다(콘솔 프리필용)")
    void withoutAStoredPolicy_returnsTheInstanceDefaults() throws Exception {
        callerTenantIsActive();
        when(policies.findCurrent("default")).thenReturn(Optional.empty());

        mvc.perform(get("/api/tenants/default/engine-policy").header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("instance-default"))
                .andExpect(jsonPath("$.revision").doesNotExist())
                .andExpect(jsonPath("$.policy.windowSize").value(10))
                .andExpect(jsonPath("$.policy.coolAfter").value(2))
                .andExpect(jsonPath("$.policy.leaseTtl").value("PT30S"))
                .andExpect(jsonPath("$.ceiling.maxWindowSize").value(100));
    }

    @Test
    @DisplayName("정책이 있으면 → 그 정책과 함께 누가 언제 바꿨는지를 돌려준다")
    void withAStoredPolicy_returnsItWithItsRevision() throws Exception {
        callerTenantIsActive();
        when(policies.findCurrent("default"))
                .thenReturn(Optional.of(new EnginePolicyRevision(
                        "default", 3, new EnginePolicy(20, 3, 2, Duration.ofSeconds(45), 6, 1.5), "admin", NOW)));

        mvc.perform(get("/api/tenants/default/engine-policy").header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("tenant"))
                .andExpect(jsonPath("$.revision.revision").value(3))
                .andExpect(jsonPath("$.revision.changedBy").value("admin"))
                .andExpect(jsonPath("$.policy.windowSize").value(20))
                .andExpect(jsonPath("$.policy.leaseTtl").value("PT45S"));
    }

    @Test
    @DisplayName("이력을 조회하면 → 최신 리비전부터 누가·언제·무엇으로 바꿨는지가 순서대로 나온다")
    void historyIsNewestFirst() throws Exception {
        callerTenantIsActive();
        when(policies.history(eq("default"), org.mockito.ArgumentMatchers.anyInt()))
                .thenReturn(List.of(
                        new EnginePolicyRevision(
                                "default", 2, new EnginePolicy(20, 3, 2, Duration.ofSeconds(45), 6, 1.0), "admin", NOW),
                        new EnginePolicyRevision(
                                "default",
                                1,
                                new EnginePolicy(10, 2, 2, Duration.ofSeconds(30), 6, 1.0),
                                "admin",
                                NOW)));

        mvc.perform(get("/api/tenants/default/engine-policy/history").header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].revision.revision").value(2))
                .andExpect(jsonPath("$[0].policy.coolAfter").value(3))
                .andExpect(jsonPath("$[1].revision.revision").value(1))
                .andExpect(jsonPath("$[1].policy.coolAfter").value(2));
    }

    @Test
    @DisplayName("유효한 정책을 저장하면 → 200 으로 새 리비전을 돌려주고 다음 풀 생성부터 적용된다고 명시한다")
    void validPolicy_isStoredAsANewRevision() throws Exception {
        callerTenantIsActive();
        EnginePolicy expected = new EnginePolicy(20, 3, 2, Duration.ofSeconds(45), 6, 1.5);
        when(policies.append(eq("default"), eq(expected), eq("admin"), eq(NOW)))
                .thenReturn(new EnginePolicyRevision("default", 1, expected, "admin", NOW));

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision.revision").value(1))
                .andExpect(jsonPath("$.revision.changedBy").value("admin"))
                .andExpect(jsonPath("$.policy.windowSize").value(20))
                .andExpect(jsonPath("$.appliesOnNextPoolBuild").value(true));

        // changedBy comes off the validated token's subject, never off the body.
        verify(policies).append("default", expected, "admin", NOW);
    }

    @Test
    @DisplayName("upstream 이 거부할 값(cool-after=0)을 저장하려 하면 → 첫 gRPC 호출의 500 이 아니라 즉시 400 이다")
    void valueTheEngineWouldReject_is400NotALaterFailure() throws Exception {
        callerTenantIsActive();

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("10", "0", "\"PT30S\"", "1.0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("cool-after")));

        verify(policies, never()).append(any(), any(), any(), any());
    }

    @Test
    @DisplayName("인스턴스 상한을 넘는 window-size 를 저장하려 하면 → 400 으로 거절하고 어떤 값이 상한인지 알려 준다")
    void aboveTheInstanceCeiling_is400() throws Exception {
        callerTenantIsActive();

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("101", "2", "\"PT30S\"", "1.0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("window-size")));

        verify(policies, never()).append(any(), any(), any(), any());
    }

    @Test
    @DisplayName("상한과 같은 값이면 → 통과한다(경계는 포함이라 운영자가 실제로 쓸 수 있는 값이다)")
    void exactlyAtTheCeiling_isAccepted() throws Exception {
        callerTenantIsActive();
        EnginePolicy atCeiling = new EnginePolicy(100, 2, 2, Duration.ofSeconds(30), 6, 1.0);
        when(policies.append(eq("default"), eq(atCeiling), any(), any()))
                .thenReturn(new EnginePolicyRevision("default", 1, atCeiling, "admin", NOW));

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("100", "2", "\"PT30S\"", "1.0")))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("필드를 하나 빼고 보내면 → 병합하지 않고 400 으로 그 필드를 요구한다(전부-또는-전무)")
    void partialBody_isRejectedRatherThanMerged() throws Exception {
        callerTenantIsActive();

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"windowSize\": 20}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("coolAfter")));

        verify(policies, never()).append(any(), any(), any(), any());
    }

    @Test
    @DisplayName("lease-ttl 이 ISO-8601 이 아니면 → 그 필드를 지목하며 400 이다")
    void malformedLeaseTtl_is400NamingTheField() throws Exception {
        callerTenantIsActive();

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("10", "2", "\"30s\"", "1.0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("leaseTtl")));
    }

    @Test
    @DisplayName("동시 저장이 같은 리비전을 다투면 → 409 로 다시 읽고 재시도하라고 답한다")
    void concurrentWrite_is409() throws Exception {
        callerTenantIsActive();
        when(policies.append(any(), any(), any(), any()))
                .thenThrow(new EnginePolicyConflictException("engine policy was concurrently changed, retry", null));

        mvc.perform(put("/api/tenants/default/engine-policy")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isConflict());
    }
}
