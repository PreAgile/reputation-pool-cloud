package io.github.preagile.reputationpool.cloud.demo;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
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
 * End-to-end proof that the demo tenant is worth showing and safe to leave switched on: the console reads
 * populated on every screen through a <em>read-only</em> login, the seed can run again without growing or
 * duplicating anything, and nothing it does reaches another tenant's rows.
 *
 * <p>The sampling/rollup schedules are pushed out to an hour so the counts this test compares are the
 * seeder's own work and not a background flush that happened to land mid-assertion.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.admin.username=operator",
            "reputation-pool.admin.password=operator-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.accounts[0].username=observer",
            "reputation-pool.admin.accounts[0].password=observer-password",
            "reputation-pool.admin.accounts[0].tenant=demo",
            "reputation-pool.admin.accounts[0].role=read-only",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "reputation-pool.demo.enabled=true",
            "reputation-pool.demo.tenant=demo",
            "reputation-pool.demo.resources=12",
            "reputation-pool.demo.steps=24",
            "reputation-pool.score.sample-interval=PT1H",
            "reputation-pool.metering.flush-interval=PT1H",
            "reputation-pool.checkpoint-interval=PT1H",
            "grpc.server.port=0"
        })
@DisplayName("DemoTenantIT: 데모 테넌트가 읽기 전용 로그인으로 모든 화면을 채우고, 재시드해도 불어나지 않으며, 타 테넌트를 건드리지 않음을 종단 검증한다")
@Import(DemoTenantIT.Containers.class)
class DemoTenantIT {

    private static final String OTHER_TENANT = "otherco";

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
    private DataSource dataSource;

    @Autowired
    private DemoDataSeeder seeder;

    @Autowired
    private ReputationPoolProperties engineProperties;

    @Autowired
    private PerTenantPoolRegistry registry;

    @Autowired
    private GlobalResourceBudget budget;

    @Autowired
    private Clock clock;

    @BeforeEach
    void seedAForeignTenant() throws SQLException {
        // A neighbour with rows in every table the seeder replaces — the control group for "scoped only".
        // Rebuilt from scratch each time (audit_event's key is a surrogate, so an upsert cannot dedupe it)
        // so every case starts from exactly one row per table and can assert an exact count.
        try (Connection connection = dataSource.getConnection()) {
            execute(
                    connection,
                    "DELETE FROM audit_event WHERE pool_id = ?",
                    statement -> statement.setString(1, OTHER_TENANT));
            execute(
                    connection,
                    "INSERT INTO tenant (id, name, status, created_at) VALUES (?, 'Otherco Ltd', 'active', ?)"
                            + " ON CONFLICT (id) DO NOTHING",
                    statement -> {
                        statement.setString(1, OTHER_TENANT);
                        statement.setTimestamp(2, Timestamp.from(Instant.now()));
                    });
            execute(
                    connection,
                    "INSERT INTO audit_event (pool_id, event_type, resource_kind, resource_value, occurred_at)"
                            + " VALUES (?, 'RESOURCE_UNBLOCKED', 'PROXY', 'other-01', 1) ON CONFLICT DO NOTHING",
                    statement -> statement.setString(1, OTHER_TENANT));
            execute(
                    connection,
                    "INSERT INTO score_sample (tenant_id, resource_kind, resource_value, context, sampled_at, score)"
                            + " VALUES (?, 'PROXY', 'other-01', 'ctx', ?, 42) ON CONFLICT DO NOTHING",
                    statement -> {
                        statement.setString(1, OTHER_TENANT);
                        statement.setTimestamp(2, Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));
                    });
            execute(
                    connection,
                    "INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)"
                            + " VALUES (?, 'lease', ?, 7, ?) ON CONFLICT DO NOTHING",
                    statement -> {
                        statement.setString(1, OTHER_TENANT);
                        statement.setObject(2, LocalDate.of(2026, 1, 1));
                        statement.setTimestamp(3, Timestamp.from(Instant.now()));
                    });
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("읽기 전용 계정으로 로그인해 대시보드를 돌면 → 개요·상세·곡선·이벤트·사용량이 모두 비어 있지 않다")
    void everyDashboardScreenIsPopulatedForTheReadOnlyLogin() {
        HttpHeaders auth = observerHeaders();

        ResponseEntity<Map> overview =
                rest.exchange("/api/pools/resources", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(overview.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> summary = (Map<String, Object>) overview.getBody().get("summary");
        List<Map<String, Object>> resources =
                (List<Map<String, Object>>) overview.getBody().get("resources");
        assertThat((Integer) summary.get("registered")).isEqualTo(12);
        assertThat((Integer) summary.get("totalCells")).isPositive();
        assertThat((Integer) summary.get("blocklisted")).isPositive();
        assertThat((Map<String, Integer>) summary.get("cellsByState"))
                .as("상태 분포가 한 칸에만 몰리면 상태 화면이 죽는다")
                .containsKeys("HEALTHY", "COOLING", "RECOVERING");
        assertThat(resources).isNotEmpty();

        Map<String, Object> withCells = resources.stream()
                .filter(resource -> (Integer) resource.get("contexts") > 0)
                .findFirst()
                .orElseThrow();
        String path = "/api/pools/resources/" + withCells.get("kind") + "/" + withCells.get("value");

        ResponseEntity<Map> detail = rest.exchange(path, HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(detail.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((List<?>) detail.getBody().get("cells")).isNotEmpty();

        ResponseEntity<Map> curve =
                rest.exchange(path + "/score-history?hours=48", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(curve.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> contexts =
                (List<Map<String, Object>>) curve.getBody().get("contexts");
        assertThat(contexts).isNotEmpty();
        assertThat((List<?>) contexts.get(0).get("points"))
                .as("점이 하나뿐이면 곡선이 아니라 점이다")
                .hasSizeGreaterThan(1);

        ResponseEntity<Map> events =
                rest.exchange("/api/events?limit=50", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(events.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((List<?>) events.getBody().get("events")).isNotEmpty();

        ResponseEntity<Map> usage = rest.exchange("/api/usage", HttpMethod.GET, new HttpEntity<>(auth), Map.class);
        assertThat(usage.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((List<?>) usage.getBody().get("dailyLeases")).isNotEmpty();
        assertThat(((Number) usage.getBody().get("poolSize")).intValue()).isEqualTo(12);
        assertThat(((Number) usage.getBody().get("monthLeaseTotal")).longValue())
                .isPositive();
    }

    @Test
    @DisplayName("데모 계정으로 리소스 차단·테넌트 삭제를 시도하면 → 실제 스택 전체를 지나서도 403 이다(시연 중 아무것도 망가뜨릴 수 없다)")
    void theDemoLoginCannotChangeAnything() {
        HttpHeaders auth = observerHeaders();

        assertThat(rest.exchange(
                                "/api/pools/resources/proxy/whatever/block?permanent=true",
                                HttpMethod.POST,
                                new HttpEntity<>(auth),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(rest.exchange("/api/tenants/demo", HttpMethod.DELETE, new HttpEntity<>(auth), String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(rest.exchange(
                                "/api/tenants/demo/api-keys",
                                HttpMethod.POST,
                                jsonEntity("{\"label\":\"x\"}", auth),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        // 거부가 "이름만"이 아니라 실제로 상태를 지켰는지: 테넌트 행이 그대로 살아 있어야 한다.
        assertThat(count("SELECT count(*) FROM tenant WHERE id = 'demo'")).isEqualTo(1);
    }

    @Test
    @DisplayName("시더를 다시 돌리면 → 행 수가 그대로여서 재기동해도 데이터가 중복되거나 불어나지 않는다")
    void reseedingIsIdempotent() throws Exception {
        long events = count("SELECT count(*) FROM audit_event WHERE pool_id = 'demo'");
        long samples = count("SELECT count(*) FROM score_sample WHERE tenant_id = 'demo'");
        long meters = count("SELECT count(*) FROM usage_meter WHERE tenant_id = 'demo'");
        long cells = count("SELECT count(*) FROM cell WHERE pool_id = 'demo'");
        assertThat(events).isPositive();
        assertThat(samples).isPositive();

        seeder.run(new DefaultApplicationArguments());
        seeder.run(new DefaultApplicationArguments());

        assertThat(count("SELECT count(*) FROM audit_event WHERE pool_id = 'demo'"))
                .isEqualTo(events);
        assertThat(count("SELECT count(*) FROM score_sample WHERE tenant_id = 'demo'"))
                .isEqualTo(samples);
        assertThat(count("SELECT count(*) FROM usage_meter WHERE tenant_id = 'demo'"))
                .isEqualTo(meters);
        assertThat(count("SELECT count(*) FROM cell WHERE pool_id = 'demo'")).isEqualTo(cells);
    }

    @Test
    @DisplayName("시더가 도는 동안 다른 테넌트의 행은 → 이벤트·점수·사용량·테넌트 어느 것도 지워지거나 바뀌지 않는다")
    void neverTouchesAnotherTenantsRows() throws Exception {
        seeder.run(new DefaultApplicationArguments());

        assertThat(count("SELECT count(*) FROM audit_event WHERE pool_id = '" + OTHER_TENANT + "'"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM score_sample WHERE tenant_id = '" + OTHER_TENANT + "'"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM usage_meter WHERE tenant_id = '" + OTHER_TENANT + "'"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM tenant WHERE id = '" + OTHER_TENANT + "' AND name = 'Otherco Ltd'"))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("데모 시더가 만들지 않은 기존 테넌트를 대상으로 지정하면 → 아무것도 지우지 않고 시딩을 건너뛴다")
    void refusesToSeedOverATenantItDidNotCreate() throws Exception {
        DemoDataProperties aimedAtRealTenant =
                new DemoDataProperties(true, OTHER_TENANT, 12, java.time.Duration.ofHours(48), 24, 30, 1L);

        new DemoDataSeeder(dataSource, aimedAtRealTenant, engineProperties, registry, budget, clock)
                .run(new DefaultApplicationArguments());

        assertThat(count("SELECT count(*) FROM audit_event WHERE pool_id = '" + OTHER_TENANT + "'"))
                .as("남의 테넌트를 겨냥한 시딩은 replace 를 시작조차 하면 안 된다")
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM score_sample WHERE tenant_id = '" + OTHER_TENANT + "'"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM cell WHERE pool_id = '" + OTHER_TENANT + "'"))
                .isZero();
    }

    private HttpHeaders observerHeaders() {
        ResponseEntity<Map> login = rest.exchange(
                "/api/auth/login",
                HttpMethod.POST,
                jsonEntity("{\"username\":\"observer\",\"password\":\"observer-password\"}", new HttpHeaders()),
                Map.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth((String) login.getBody().get("token"));
        return headers;
    }

    private static HttpEntity<String> jsonEntity(String body, HttpHeaders headers) {
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }

    private long count(String sql) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet rows = statement.executeQuery()) {
            return rows.next() ? rows.getLong(1) : 0L;
        } catch (SQLException e) {
            throw new IllegalStateException(sql, e);
        }
    }

    private interface Binder {
        void bind(PreparedStatement statement) throws SQLException;
    }

    private static void execute(Connection connection, String sql, Binder binder) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            binder.bind(statement);
            statement.executeUpdate();
        }
    }
}
