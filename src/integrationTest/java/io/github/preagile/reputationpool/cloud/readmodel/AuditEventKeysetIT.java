package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
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
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * End-to-end for the audit-event keyset pagination (issue #30) against a real PostgreSQL
 * (Testcontainers). Seeds a known run of {@code audit_event} rows directly, then walks
 * {@code GET /api/events?cursor=&limit=} over HTTP with the admin token and asserts the keyset
 * contract: newest-first, cursor-chained pages that neither overlap nor gap, a {@code null}
 * {@code nextCursor} on the last page, and a 400 for a malformed cursor.
 *
 * <p>{@code grpc.server.port=0} keeps this context off the fixed gRPC port so it can coexist with other
 * IT contexts. Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=keyset-it-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "grpc.server.port=0"
        })
@Import(AuditEventKeysetIT.Containers.class)
@DisplayName("AuditEventKeysetIT: 실제 PostgreSQL 에서 audit 이벤트 keyset(cursor/limit) 페이지네이션을 HTTP 로 종단 검증하는 통합테스트")
class AuditEventKeysetIT {

    private static final ParameterizedTypeReference<Map<String, Object>> MAP = new ParameterizedTypeReference<>() {};

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

    @Test
    @DisplayName("이벤트 5건을 심고 limit=2 로 커서를 따라가면 → 최신부터 내림차순으로 겹침/누락 없이 이어지고 마지막 페이지의 nextCursor 는 null 이다")
    void keysetPaging_walksNewestFirstWithoutOverlapOrGap() {
        List<Long> seededDesc = seedEvents(5); // returns the seeded seqs, newest first
        HttpHeaders auth = authHeaders();

        List<Long> walked = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        String lastNextCursor = "unset";
        do {
            String url = cursor == null ? "/api/events?limit=2" : "/api/events?limit=2&cursor=" + cursor;
            ResponseEntity<Map<String, Object>> page = rest.exchange(url, HttpMethod.GET, new HttpEntity<>(auth), MAP);
            assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> events =
                    (List<Map<String, Object>>) page.getBody().get("events");
            for (Map<String, Object> e : events) {
                walked.add(((Number) e.get("seq")).longValue());
            }
            cursor = (String) page.getBody().get("nextCursor");
            lastNextCursor = cursor;
            pages++;
            assertThat(pages).isLessThanOrEqualTo(10); // guard against a runaway cursor loop
        } while (cursor != null);

        // (a) newest-first descending, (b) no overlap/gap: the walk equals exactly the seeded seqs desc,
        // (c) three pages (2 + 2 + 1), (d) last page's nextCursor is null.
        assertThat(walked).containsExactlyElementsOf(seededDesc);
        assertThat(walked).isSortedAccordingTo((a, b) -> Long.compare(b, a));
        assertThat(pages).isEqualTo(3);
        assertThat(lastNextCursor).isNull();
    }

    @Test
    @DisplayName("깨진 커서로 이벤트를 조회하면 → 400 Bad Request 로 거부한다")
    void malformedCursor_is400() {
        HttpHeaders auth = authHeaders();
        ResponseEntity<String> response = rest.exchange(
                "/api/events?cursor=not-a-valid-cursor!!!", HttpMethod.GET, new HttpEntity<>(auth), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    /** Inserts {@code count} audit rows; returns their generated seqs newest-first (descending). */
    private List<Long> seedEvents(int count) {
        List<Long> seqs = new ArrayList<>();
        String insert = """
                INSERT INTO audit_event (event_type, resource_kind, resource_value, context, occurred_at, until, cause)
                VALUES ('RESOURCE_LEASED', 'PROXY', ?, 'ctx', ?, NULL, NULL)""";
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(insert, new String[] {"seq"})) {
            for (int i = 0; i < count; i++) {
                statement.setString(1, "res-" + i);
                statement.setLong(2, 1_000_000_000L * (i + 1)); // strictly increasing occurred_at
                statement.executeUpdate();
                try (var keys = statement.getGeneratedKeys()) {
                    assertThat(keys.next()).isTrue();
                    seqs.add(keys.getLong(1));
                }
            }
        } catch (Exception e) {
            throw new IllegalStateException("failed to seed audit_event", e);
        }
        seqs.sort((a, b) -> Long.compare(b, a)); // newest (highest seq) first
        return seqs;
    }

    private HttpHeaders authHeaders() {
        ResponseEntity<Map<String, Object>> login = rest.exchange(
                "/api/auth/login",
                HttpMethod.POST,
                json(Map.of("username", "admin", "password", "s3cret-password")),
                MAP);
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
