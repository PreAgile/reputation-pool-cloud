package io.github.preagile.reputationpool.cloud.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full-context integration test for the Prometheus scrape endpoint against a real PostgreSQL
 * (Testcontainers). Proves the endpoint is reachable without a token and exposes the pool's counters:
 *
 * <ul>
 *   <li><b>permitAll for the scraper (#14):</b> {@code /actuator/prometheus} joins health/info in the
 *       permitAll set, so an in-cluster Prometheus can pull it with no bearer token. The trust boundary
 *       is the network — the app binds loopback-only and Caddy does not route this path to the outside,
 *       so it is reachable only from inside the compose network (verified operationally, not here).
 *   <li><b>Counters are registered (#45):</b> the scrape body carries the {@link MetricsEventSink}
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
@DisplayName("PrometheusScrapeIT: /actuator/prometheus 가 토큰 없이 스크레이프되고 reputation 카운터를 노출하는지 종단 검증하는 통합테스트")
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
    @DisplayName("토큰 없이 /actuator/prometheus 를 호출하면 → 200 과 함께 reputation 카운터가 노출된다 (permitAll · 내부 스크레이프)")
    void scrapeIsReachableWithoutTokenAndExposesCounters() {
        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Micrometer renders reputation.resource.blocklisted -> reputation_resource_blocklisted_total.
        // Pre-registered at 0, so it is present even before any pool event fires.
        assertThat(res.getBody())
                .contains("reputation_resource_blocklisted_total")
                .contains("reputation_lease_granted_total");
    }
}
