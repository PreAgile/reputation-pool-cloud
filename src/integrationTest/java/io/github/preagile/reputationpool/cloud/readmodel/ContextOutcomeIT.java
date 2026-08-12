package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRollup;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
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
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * End-to-end for the issue #189 read-model additions against a real PostgreSQL (Testcontainers): the
 * {@link OutcomeRollup} folds {@link OutcomeRecorder}'s in-memory counts into the V106
 * {@code report_outcome_hourly} table, and the {@code success-rate} endpoint reads them back per context
 * with the per-{@link FailureType} breakdown.
 *
 * <p>Three properties of the design that only a real database can show, and that this test therefore
 * exists for: the V106 migration actually applies, the upsert <b>accumulates</b> across flushes (a
 * counter, not a gauge — an overwrite would silently discard every earlier minute of the hour), and the
 * retention purge drops rows by bucket age.
 *
 * <p>The bound tenant for every HTTP call is the admin tenant ({@code default}); this test drives the
 * recorder for that same tenant, so the flush and the reads see one shared state.
 * {@code outcome.flush-interval=PT1H} and {@code outcome.purge-interval=PT1H} park both scheduled tasks so
 * the test drives them explicitly (the MeteringIT idiom); {@code grpc.server.port=0} keeps the context off
 * the fixed port. Requires Docker; runs via {@code ./gradlew integrationTest}.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=outcome-it-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "reputation-pool.outcome.flush-interval=PT1H",
            "reputation-pool.outcome.purge-interval=PT1H",
            "reputation-pool.outcome.retention=P2D",
            "grpc.server.port=0"
        })
@Import(ContextOutcomeIT.Containers.class)
@DisplayName(
        "ContextOutcomeIT: 실제 PostgreSQL 의 report_outcome_hourly 에 컨텍스트별 성공/실패가 적재되고 success-rate 로 되읽히는지 검증하는 통합테스트")
class ContextOutcomeIT {

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
    private OutcomeRecorder recorder;

    @Autowired
    private OutcomeRollup rollup;

    @Autowired
    private Clock clock;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ReputationPoolProperties properties;

    private Instant currentHour() {
        return clock.instant().truncatedTo(ChronoUnit.HOURS);
    }

    @Test
    @DisplayName("성공 6·BLOCKED 3·TIMEOUT 1 을 한 컨텍스트로 기록하고 플러시하면 → success-rate 가 0.6 과 실패 종류별 분해를 돌려준다")
    void successRateAndFailureBreakdownAreQueryable() {
        Instant hour = currentHour();
        String context = "rate-scrape";
        for (int i = 0; i < 6; i++) {
            recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);
        }
        for (int i = 0; i < 3; i++) {
            recorder.recordFailure("default", context, ResourceKind.PROXY, hour, FailureType.BLOCKED);
        }
        recorder.recordFailure("default", context, ResourceKind.PROXY, hour, FailureType.TIMEOUT);

        rollup.flush();

        Map<String, Object> series = seriesFor(context, 24);
        Map<String, Object> totals = (Map<String, Object>) series.get("totals");
        assertThat(((Number) totals.get("success")).longValue()).isEqualTo(6);
        assertThat(((Number) totals.get("failure")).longValue()).isEqualTo(4);
        assertThat(((Number) totals.get("successRate")).doubleValue()).isCloseTo(0.6, within(1e-9));

        Map<String, Object> failures = (Map<String, Object>) totals.get("failures");
        assertThat(((Number) failures.get("BLOCKED")).longValue()).isEqualTo(3);
        assertThat(((Number) failures.get("TIMEOUT")).longValue()).isEqualTo(1);
        // 일어나지 않은 종류도 0 으로 실려 온다 — 클라이언트가 빠진 키를 메울 필요가 없게.
        assertThat(failures).containsKeys("SLOW", "CONNECTION_RESET", "TLS_HANDSHAKE");
        assertThat(((Number) failures.get("SLOW")).longValue()).isZero();

        List<Map<String, Object>> points = (List<Map<String, Object>>) series.get("points");
        assertThat(points).hasSize(1);
        assertThat(((Number) points.get(0).get("successRate")).doubleValue()).isCloseTo(0.6, within(1e-9));
    }

    @Test
    @DisplayName("같은 시간 버킷을 두 번 나눠 플러시하면 → 두 번째 플러시가 첫 번째를 덮어쓰지 않고 누적된다(게이지가 아니라 카운터)")
    void repeatedFlushesAccumulateIntoTheSameBucket() {
        Instant hour = currentHour();
        String context = "rate-accumulate";

        recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);
        recorder.recordFailure("default", context, ResourceKind.PROXY, hour, FailureType.SLOW);
        rollup.flush();

        recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);
        recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);
        rollup.flush();

        Map<String, Object> totals =
                (Map<String, Object>) seriesFor(context, 24).get("totals");
        assertThat(((Number) totals.get("success")).longValue()).isEqualTo(3);
        assertThat(((Number) totals.get("failure")).longValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 컨텍스트를 PROXY·ACCOUNT 로 나눠 기록해도 → 컨텍스트 축 조회는 리소스 종류를 합산해 한 시리즈로 돌려준다")
    void resourceKindsAreSummedOnTheContextAxis() {
        Instant hour = currentHour();
        String context = "rate-kinds";
        recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);
        recorder.recordSuccess("default", context, ResourceKind.ACCOUNT, hour);
        recorder.recordFailure("default", context, ResourceKind.SESSION, hour, FailureType.TLS_HANDSHAKE);

        rollup.flush();

        Map<String, Object> series = seriesFor(context, 24);
        List<Map<String, Object>> points = (List<Map<String, Object>>) series.get("points");
        assertThat(points).as("세 종류가 한 시간 버킷 한 점으로 합쳐진다").hasSize(1);
        Map<String, Object> totals = (Map<String, Object>) series.get("totals");
        assertThat(((Number) totals.get("success")).longValue()).isEqualTo(2);
        assertThat(((Number) totals.get("failure")).longValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("조회 창(hours)보다 오래된 버킷은 → 같은 컨텍스트라도 합계에 들어오지 않는다")
    void bucketsOutsideTheWindowAreExcluded() {
        String context = "rate-window";
        recorder.recordSuccess("default", context, ResourceKind.PROXY, currentHour());
        recorder.recordFailure(
                "default", context, ResourceKind.PROXY, currentHour().minus(5, ChronoUnit.HOURS), FailureType.BLOCKED);
        rollup.flush();

        // 2시간 창: 5시간 전 실패는 밖이므로 성공률 1.0
        Map<String, Object> narrow = (Map<String, Object>) seriesFor(context, 2).get("totals");
        assertThat(((Number) narrow.get("successRate")).doubleValue()).isCloseTo(1.0, within(1e-9));

        // 24시간 창: 둘 다 들어오므로 0.5
        Map<String, Object> wide = (Map<String, Object>) seriesFor(context, 24).get("totals");
        assertThat(((Number) wide.get("successRate")).doubleValue()).isCloseTo(0.5, within(1e-9));
    }

    @Test
    @DisplayName("보존 기간(P2D)보다 오래된 버킷은 → 퍼지가 지우고 최근 버킷은 남긴다")
    void retentionPurgeDropsBucketsOlderThanTheWindow() {
        String context = "rate-retention";
        Instant recent = currentHour();
        Instant ancient = recent.minus(5, ChronoUnit.DAYS);
        recorder.recordSuccess("default", context, ResourceKind.PROXY, recent);
        recorder.recordSuccess("default", context, ResourceKind.PROXY, ancient);
        rollup.flush();
        // 퍼지 전: 1년 창에서 두 버킷이 다 보인다.
        assertThat((List<?>) seriesFor(context, 24 * 365).get("points")).hasSize(2);

        rollup.purgeExpired();

        List<?> remaining = (List<?>) seriesFor(context, 24 * 365).get("points");
        assertThat(remaining).as("5일 전 버킷만 지워지고 현재 시간 버킷은 남는다").hasSize(1);
    }

    /**
     * The per-bucket isolation {@link OutcomeRollup} documents is a statement about commit boundaries, and
     * a commit boundary is not something a class gets to assume — it is whatever the pool was configured
     * with. Under {@code auto-commit=false} the whole flush would instead be one transaction that
     * {@code close()} throws away, so every count would vanish without a single error being logged: the
     * quietest possible failure. Simulated with a pool that hands out non-auto-commit connections.
     */
    @Test
    @DisplayName("커넥션 풀이 auto-commit=false 로 커넥션을 내줘도 → 플러시한 버킷이 커밋되어 조회에 잡힌다")
    void theFlushCommitsEvenWhenThePoolDisablesAutoCommit() {
        String context = "rate-autocommit";
        OutcomeRecorder isolated = new OutcomeRecorder();
        isolated.recordSuccess("default", context, ResourceKind.PROXY, currentHour());

        new OutcomeRollup(nonAutoCommitPool(), clock, isolated, properties).flush();

        Map<String, Object> totals =
                (Map<String, Object>) seriesFor(context, 24).get("totals");
        assertThat(((Number) totals.get("success")).longValue()).isEqualTo(1);
    }

    /** The same database behind a pool configured the way {@code OutcomeRollup} must not depend on. */
    private DataSource nonAutoCommitPool() {
        return new DelegatingDataSource(dataSource) {
            @Override
            public Connection getConnection() throws SQLException {
                Connection connection = super.getConnection();
                connection.setAutoCommit(false);
                return connection;
            }
        };
    }

    /**
     * The bucket key is a point in time, and it is written by one component and read back by another. If
     * those two ever disagree about what the stored value means, nothing fails loudly — the counts simply
     * land in, or are read out of, the wrong hour, and every rate on the screen is wrong by a whole
     * timezone offset while looking perfectly plausible. That is why this asserts the stored value
     * directly (in UTC wall-clock, without going back through JDBC's conversion) as well as the instant
     * the read model returns, rather than trusting a round trip through one library to be self-consistent.
     */
    @Test
    @DisplayName("버킷 시각은 → DB 에 기록한 UTC 순간 그대로 저장되고, 읽기 모델도 같은 순간으로 되읽는다")
    void theBucketHourIsStoredAndReadBackAsTheSameInstant() throws Exception {
        String context = "rate-instant";
        Instant hour = currentHour().minus(3, ChronoUnit.HOURS);
        recorder.recordSuccess("default", context, ResourceKind.PROXY, hour);

        rollup.flush();

        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement("SELECT bucket_hour AT TIME ZONE 'UTC'"
                        + " FROM report_outcome_hourly WHERE tenant_id = 'default' AND context = ?")) {
            statement.setString(1, context);
            try (ResultSet rows = statement.executeQuery()) {
                assertThat(rows.next()).as("플러시가 그 버킷을 실제로 한 행으로 썼다").isTrue();
                assertThat(rows.getObject(1, LocalDateTime.class))
                        .as("timestamptz 에 저장된 값을 UTC 벽시계로 보면 기록한 시각 그대로다")
                        .isEqualTo(LocalDateTime.ofInstant(hour, ZoneOffset.UTC));
            }
        }

        List<Map<String, Object>> points =
                (List<Map<String, Object>>) seriesFor(context, 24).get("points");
        assertThat(points).hasSize(1);
        assertThat(Instant.parse((String) points.get(0).get("at")))
                .as("읽기 모델이 돌려주는 시각도 같은 순간이다")
                .isEqualTo(hour);
    }

    /** The one context's series out of the whole-tenant response, so each test reads only what it wrote. */
    private Map<String, Object> seriesFor(String context, int hours) {
        ResponseEntity<Map> response = rest.exchange(
                "/api/contexts/success-rate?hours=" + hours,
                HttpMethod.GET,
                new HttpEntity<>(authHeaders()),
                Map.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> contexts =
                (List<Map<String, Object>>) response.getBody().get("contexts");
        return contexts.stream()
                .filter(series -> context.equals(series.get("context")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("context " + context + " missing from success-rate response"));
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
