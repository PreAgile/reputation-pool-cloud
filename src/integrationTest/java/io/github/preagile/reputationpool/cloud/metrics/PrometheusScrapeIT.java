package io.github.preagile.reputationpool.cloud.metrics;

import static org.assertj.core.api.Assertions.assertThat;

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
 * Full-context integration test for the Prometheus scrape endpoint (issue #45, metric consumption)
 * against a real PostgreSQL (Testcontainers). Proves two things end to end over HTTP:
 *
 * <ul>
 *   <li><b>Exposed but fail-closed:</b> {@code /actuator/prometheus} is enabled, but — sitting under the
 *       {@code authenticated()} catch-all rather than the health/info permitAll — a call without a token
 *       is rejected 401. Only the admin bearer token gets in.
 *   <li><b>Counters are registered:</b> with the token the scrape body carries the {@link MetricsEventSink}
 *       counters (pre-registered at 0), proving the sink's meters reach the endpoint.
 * </ul>
 *
 * <p>{@code grpc.server.port=0} keeps this context off the fixed gRPC port so it can coexist with other IT
 * contexts. Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
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
@DisplayName("PrometheusScrapeIT: /actuator/prometheus 가 인증 뒤에서 메트릭 카운터를 노출하는지 종단 검증하는 통합테스트")
@Import(PrometheusScrapeIT.Containers.class)
class PrometheusScrapeIT {

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

    @Test
    @DisplayName("토큰 없이 /actuator/prometheus 를 호출하면 → 401 로 차단한다 (fail-closed)")
    void scrapeWithoutToken_is401() {
        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("관리자 토큰으로 호출하면 → 200 과 함께 reputation 메트릭 카운터가 스크레이프에 노출된다")
    void scrapeWithToken_exposesReputationCounters() {
        ResponseEntity<String> res =
                rest.exchange("/actuator/prometheus", HttpMethod.GET, new HttpEntity<>(authHeaders()), String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Micrometer renders reputation.resource.blocklisted -> reputation_resource_blocklisted_total.
        // Pre-registered at 0, so it is present even before any pool event fires.
        assertThat(res.getBody())
                .contains("reputation_resource_blocklisted_total")
                .contains("reputation_lease_granted_total");
    }

    /** Logs in with the configured admin credentials and returns headers carrying the bearer token. */
    private HttpHeaders authHeaders() {
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> login = rest.exchange(
                "/api/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", "admin", "password", "s3cret-password"), json),
                Map.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        String token = (String) login.getBody().get("token");
        assertThat(token).isNotBlank();
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }
}
