package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
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
    void protectedEndpoint_withoutToken_is401() {
        ResponseEntity<String> response = rest.getForEntity("/api/tenants", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void tenantCrud_andDuplicateIsConflict() {
        HttpHeaders auth = authHeaders();

        ResponseEntity<Map> created = rest.exchange(
                "/api/tenants", HttpMethod.POST, json(Map.of("id", "acme", "name", "ACME Inc"), auth), Map.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).containsEntry("id", "acme").containsEntry("status", "active");

        ResponseEntity<Map> duplicate =
                rest.exchange("/api/tenants", HttpMethod.POST, json(Map.of("id", "acme"), auth), Map.class);
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        ResponseEntity<Map> fetched =
                rest.exchange("/api/tenants/acme", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(fetched.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(fetched.getBody()).containsEntry("id", "acme");

        ResponseEntity<List> all = rest.exchange("/api/tenants", HttpMethod.GET, new HttpEntity<>(auth), List.class);
        assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(all.getBody())
                .anySatisfy(t -> assertThat(((Map<?, ?>) t).get("id")).isEqualTo("acme"));
    }

    @Test
    void apiKeyLifecycle_issueResolveRevoke() {
        HttpHeaders auth = authHeaders();
        rest.exchange("/api/tenants", HttpMethod.POST, json(Map.of("id", "keyco"), auth), Map.class);

        // Issue: the raw token is returned exactly once.
        ResponseEntity<Map> issued = rest.exchange(
                "/api/tenants/keyco/api-keys", HttpMethod.POST, json(Map.of("label", "ci"), auth), Map.class);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String rawToken = (String) issued.getBody().get("rawToken");
        String keyId = (String) issued.getBody().get("id");
        assertThat(rawToken).startsWith("rp_");

        // The gRPC plane's resolver accepts it, mapped to its tenant.
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256(rawToken))).contains("keyco");

        // Listing never leaks the raw token; it shows the masked prefix.
        ResponseEntity<List> listed =
                rest.exchange("/api/tenants/keyco/api-keys", HttpMethod.GET, new HttpEntity<>(auth), List.class);
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(listed.getBody()).anySatisfy(k -> {
            @SuppressWarnings("unchecked")
            Map<String, Object> key = (Map<String, Object>) k;
            assertThat(key).doesNotContainKey("rawToken");
            assertThat((String) key.get("prefix")).startsWith("rp_");
        });

        // Revoke: immediate — the same token no longer resolves.
        ResponseEntity<Void> revoked = rest.exchange(
                "/api/tenants/keyco/api-keys/" + keyId, HttpMethod.DELETE, new HttpEntity<>(auth), Void.class);
        assertThat(revoked.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(resolver.resolveByKeyHash(ApiKeyHashing.sha256(rawToken))).isEmpty();

        // Revoking again (or an unknown id) is a 404.
        ResponseEntity<Map> revokeAgain = rest.exchange(
                "/api/tenants/keyco/api-keys/" + keyId, HttpMethod.DELETE, new HttpEntity<>(auth), Map.class);
        assertThat(revokeAgain.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void readModel_isReachableWithToken() {
        HttpHeaders auth = authHeaders();

        ResponseEntity<Map> pools =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(pools.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(pools.getBody()).containsKey("summary").containsKey("resources");

        ResponseEntity<Map> events =
                rest.exchange("/api/events?page=0&size=10", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(events.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(events.getBody()).containsKey("events");
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

    private static HttpEntity<Map<String, Object>> json(Map<String, Object> body, HttpHeaders headers) {
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
