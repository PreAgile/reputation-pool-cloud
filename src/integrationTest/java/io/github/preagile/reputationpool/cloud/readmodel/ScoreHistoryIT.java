package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.metering.ScoreSampler;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.Outcome;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import java.time.Duration;
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
 * End-to-end for the issue #12 read-model additions against a real PostgreSQL (Testcontainers): the
 * {@link ScoreSampler} loads {@code score_sample} from live pool cells, the {@code score-history}
 * endpoint reads it back per context, and the overview surfaces each resource's representative
 * state/score/recentWindow.
 *
 * <p>The bound tenant for every HTTP call is the admin tenant ({@code default}); this test drives that
 * same pool directly through the registry, so the sampler and the reads see one shared state.
 * {@code score.sample-interval=PT1H} parks the scheduled sampler so the test flushes it explicitly (the
 * MeteringIT idiom); {@code grpc.server.port=0} keeps the context off the fixed port. Requires Docker;
 * runs via {@code ./gradlew integrationTest}.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=score-it-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "reputation-pool.score.sample-interval=PT1H",
            "grpc.server.port=0"
        })
@Import(ScoreHistoryIT.Containers.class)
@DisplayName("ScoreHistoryIT: 실제 PostgreSQL 에 적재된 score_sample 을 score-history·overview 엔드포인트가 되읽어 주는지 검증하는 통합테스트")
class ScoreHistoryIT {

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
    private PerTenantPoolRegistry registry;

    @Autowired
    private ScoreSampler sampler;

    @Test
    @DisplayName("정상·쿨링 컨텍스트를 샘플링하면 → score-history 는 컨텍스트별 점수 시계열을, overview 는 최악 상태(COOLING) 대표 셀을 노출한다")
    void samplesAreQueryableAndOverviewSurfacesRepresentativeCell() {
        // Drive the admin tenant's pool: one resource, a healthy context and a cooling one.
        ResourcePool pool = registry.poolFor("default");
        ResourceId resource = new ResourceId(ResourceKind.PROXY, "sc1");
        pool.register(resource);
        Context healthy = new Context("healthy");
        Context cooling = new Context("cooling");
        for (int i = 0; i < 3; i++) {
            pool.report(resource, healthy, new Outcome.Success(Duration.ofMillis(10)));
        }
        // Enough consecutive failures to trip the cooldown (coolAfter defaults to 2).
        for (int i = 0; i < 3; i++) {
            pool.report(resource, cooling, new Outcome.Failure(FailureType.BLOCKED, Duration.ofMillis(30)));
        }

        sampler.flush();

        HttpHeaders auth = authHeaders();

        // score-history: one ascending-time series per context, each with the sampled point.
        ResponseEntity<Map> history = rest.exchange(
                "/api/pools/resources/proxy/sc1/score-history?hours=24",
                HttpMethod.GET,
                new HttpEntity<>(auth),
                Map.class);
        assertThat(history.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> contexts =
                (List<Map<String, Object>>) history.getBody().get("contexts");
        assertThat(contexts).hasSize(2);
        assertThat(contexts).allSatisfy(series -> {
            assertThat(series.get("context")).isNotNull();
            List<?> points = (List<?>) series.get("points");
            assertThat(points).isNotEmpty();
            @SuppressWarnings("unchecked")
            Map<String, Object> first = (Map<String, Object>) points.get(0);
            assertThat(first).containsKey("at").containsKey("score");
        });

        // overview: the sc1 row reads COOLING (worst severity), a non-null score, and the cooling
        // cell's window (all failures) as its recentWindow.
        ResponseEntity<Map> overview =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(overview.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> resources =
                (List<Map<String, Object>>) overview.getBody().get("resources");
        assertThat(resources).anySatisfy(row -> {
            assertThat(row.get("value")).isEqualTo("sc1");
            assertThat(row.get("state")).isEqualTo("COOLING");
            assertThat(row.get("score")).isNotNull();
            @SuppressWarnings("unchecked")
            List<Boolean> window = (List<Boolean>) row.get("recentWindow");
            assertThat(window).isNotEmpty().contains(false);
        });
    }

    private HttpHeaders authHeaders() {
        ResponseEntity<Map> login = rest.exchange(
                "/api/auth/login",
                HttpMethod.POST,
                json(Map.of("username", "admin", "password", "s3cret-password")),
                Map.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth((String) login.getBody().get("token"));
        return headers;
    }

    private static HttpEntity<Map<String, Object>> json(Map<String, Object> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
