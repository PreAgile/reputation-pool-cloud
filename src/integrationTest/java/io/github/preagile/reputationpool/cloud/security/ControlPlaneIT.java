package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full-context integration test for the REST control plane (issue #11) against a real PostgreSQL
 * (Testcontainers). Proves the round trips the plan requires end to end over HTTP:
 *
 * <ul>
 *   <li>admin login mints a JWT, and protected endpoints reject calls without one (401);
 *   <li>tenant CRUD works and a duplicate id is a 409;
 *   <li>an issued key's raw token resolves to its tenant through the same {@link TenantResolver} the
 *       gRPC plane uses, and after revocation it no longer resolves (revocation is immediate);
 *   <li>the dashboard read model (pool snapshot + audit events) is reachable with the token.
 * </ul>
 *
 * <p>{@code grpc.server.port=0} keeps this context off the fixed gRPC port so it can coexist with other
 * IT contexts. Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=integration-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "grpc.server.port=0"
        })
@DisplayName("ControlPlaneIT: 실제 PostgreSQL 위에서 REST 컨트롤 플레인의 인증·테넌트/API키 CRUD·대시보드 조회를 HTTP 로 종단 검증하는 통합테스트")
@Import(ControlPlaneIT.Containers.class)
class ControlPlaneIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private TenantResolver resolver;

    @Test
    @DisplayName("토큰 없이 보호된 엔드포인트를 호출하면 → 401 Unauthorized 로 차단한다")
    void protectedEndpoint_withoutToken_is401() {
        ResponseEntity<String> response = rest.getForEntity("/api/tenants", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("테넌트 생성·목록은 운영자 전역 행위로 되고 중복은 409, 단건 조회는 토큰 테넌트로 스코프되어 자기 테넌트는 200·타 테넌트는 403 이다(#82)")
    void tenantCrud_andScopedSingleGet() {
        HttpHeaders auth = authHeaders();

        // create·list 는 운영자 전역 행위(#31) — 토큰 테넌트(default)와 다른 acme 도 만들 수 있다.
        ResponseEntity<Map> created = rest.exchange(
                "/api/tenants", HttpMethod.POST, json(Map.of("id", "acme", "name", "ACME Inc"), auth), Map.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).containsEntry("id", "acme").containsEntry("status", "active");

        ResponseEntity<Map> duplicate =
                rest.exchange("/api/tenants", HttpMethod.POST, json(Map.of("id", "acme"), auth), Map.class);
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        ResponseEntity<List> all = rest.exchange("/api/tenants", HttpMethod.GET, new HttpEntity<>(auth), List.class);
        assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(all.getBody())
                .anySatisfy(t -> assertThat(((Map<?, ?>) t).get("id")).isEqualTo("acme"));

        // #82: 단건 조회는 토큰 테넌트로 스코프된다. 토큰의 default 테넌트가 존재하도록 보장(이미 있으면 409, 둘 다 OK).
        ensureTenantExists(auth, "default");

        ResponseEntity<Map> own =
                rest.exchange("/api/tenants/default", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(own.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(own.getBody()).containsEntry("id", "default");

        // 토큰 스코프 밖(acme)은 존재하더라도 404 가 아니라 403 — 존재 비노출.
        ResponseEntity<Map> other =
                rest.exchange("/api/tenants/acme", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(other.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("API 키를 발급하면 원문 토큰이 resolver 로 테넌트에 매핑되고 목록엔 마스킹만 노출되며, 폐기하면 → 즉시 매핑이 사라지고 재폐기는 404 다")
    void apiKeyLifecycle_issueResolveRevoke() {
        HttpHeaders auth = authHeaders();
        // 키 발급/목록/폐기는 토큰 테넌트로 스코프된다(#82) — 토큰의 default 테넌트로만 다룬다.
        ensureTenantExists(auth, "default");

        // Issue: the raw token is returned exactly once.
        ResponseEntity<Map> issued = rest.exchange(
                "/api/tenants/default/api-keys", HttpMethod.POST, json(Map.of("label", "ci"), auth), Map.class);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String rawToken = (String) issued.getBody().get("rawToken");
        String keyId = (String) issued.getBody().get("id");
        assertThat(rawToken).startsWith("rp_");

        // The gRPC plane's resolver accepts it, mapped to its tenant.
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256(rawToken))).contains("default");

        // Listing never leaks the raw token; it shows the masked prefix.
        ResponseEntity<List> listed =
                rest.exchange("/api/tenants/default/api-keys", HttpMethod.GET, new HttpEntity<>(auth), List.class);
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(listed.getBody()).anySatisfy(k -> {
            @SuppressWarnings("unchecked")
            Map<String, Object> key = (Map<String, Object>) k;
            assertThat(key).doesNotContainKey("rawToken");
            assertThat((String) key.get("prefix")).startsWith("rp_");
        });

        // Revoke: immediate — the same token no longer resolves.
        ResponseEntity<Void> revoked = rest.exchange(
                "/api/tenants/default/api-keys/" + keyId, HttpMethod.DELETE, new HttpEntity<>(auth), Void.class);
        assertThat(revoked.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256(rawToken))).isEmpty();

        // Revoking again (or an unknown id) is a 404.
        ResponseEntity<Map> revokeAgain = rest.exchange(
                "/api/tenants/default/api-keys/" + keyId, HttpMethod.DELETE, new HttpEntity<>(auth), Map.class);
        assertThat(revokeAgain.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("토큰 테넌트(default)와 다른 테넌트의 키 발급을 시도하면 → 존재 여부와 무관하게 403 으로 거부한다(#82 종단 회귀)")
    void apiKeyIssueForOtherTenant_is403() {
        HttpHeaders auth = authHeaders();
        // otherco 는 존재하는 타 테넌트지만, 토큰 스코프 밖이므로 404 가 아니라 403 이어야 한다.
        ensureTenantExists(auth, "otherco");

        ResponseEntity<Map> issued = rest.exchange(
                "/api/tenants/otherco/api-keys", HttpMethod.POST, json(Map.of("label", "x"), auth), Map.class);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("토큰을 가지고 대시보드 읽기 모델(풀 스냅샷·이벤트)을 호출하면 → 200 으로 조회된다")
    void readModel_isReachableWithToken() {
        HttpHeaders auth = authHeaders();

        ResponseEntity<Map> pools =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(pools.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(pools.getBody()).containsKey("summary").containsKey("resources");

        ResponseEntity<Map> events =
                rest.exchange("/api/events?limit=10", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(events.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(events.getBody()).containsKey("events");
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("리소스를 수동 영구 차단하면 개요에 BLOCKLISTED 로 나타나고, 차단 해제하면 → 개요에서 완전히 사라진다")
    void manualBlockThenUnblock() {
        HttpHeaders auth = authHeaders();

        // Permanently block a resource (operator intervention). The engine has no auto-blocklist, so
        // this endpoint is the only path that produces a BLOCKLISTED resource.
        ResponseEntity<Void> blocked = rest.exchange(
                "/api/pools/resources/proxy/blk-01/block?permanent=true",
                HttpMethod.POST,
                new HttpEntity<>(auth),
                Void.class);
        assertThat(blocked.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<Map> overview =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        List<Map<String, Object>> resources =
                (List<Map<String, Object>>) overview.getBody().get("resources");
        assertThat(resources).anySatisfy(r -> {
            assertThat(r.get("value")).isEqualTo("blk-01");
            assertThat(r.get("blocked")).isEqualTo(true);
            assertThat(r.get("blockPermanent")).isEqualTo(true);
            assertThat(r.get("state")).isEqualTo("BLOCKLISTED");
        });

        // Unblock → immediate; a cell-less, unregistered resource drops out of the overview entirely.
        ResponseEntity<Void> unblocked = rest.exchange(
                "/api/pools/resources/proxy/blk-01/block", HttpMethod.DELETE, new HttpEntity<>(auth), Void.class);
        assertThat(unblocked.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<Map> after =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        List<Map<String, Object>> stillThere =
                (List<Map<String, Object>>) after.getBody().get("resources");
        assertThat(stillThere).noneSatisfy(r -> {
            assertThat(r.get("value")).isEqualTo("blk-01");
            assertThat(r.get("blocked")).isEqualTo(true);
        });
    }

    /** Logs in with the configured admin credentials and returns headers carrying the bearer token. */
    private HttpHeaders authHeaders() {
        ResponseEntity<Map> login = rest.exchange(
                "/api/auth/login",
                HttpMethod.POST,
                json(Map.of("username", "admin", "password", "s3cret-password"), new HttpHeaders()),
                Map.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        String token = (String) login.getBody().get("token");
        assertThat(token).isNotBlank();
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    /**
     * Ensures a tenant row exists (tenant creation is an operator-global action, #31). Tolerates 409 so
     * the shared-context IT can call it across methods without ordering coupling — 201 (created) and 409
     * (already there) both mean "exists".
     */
    private void ensureTenantExists(HttpHeaders auth, String id) {
        ResponseEntity<Map> created =
                rest.exchange("/api/tenants", HttpMethod.POST, json(Map.of("id", id), auth), Map.class);
        assertThat(created.getStatusCode()).isIn(HttpStatus.CREATED, HttpStatus.CONFLICT);
    }

    private static HttpEntity<Map<String, Object>> json(Map<String, Object> body, HttpHeaders headers) {
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
