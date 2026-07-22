package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventPage;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * End-to-end for the audit trail's per-tenant read scope (issue #29) against a real PostgreSQL
 * (Testcontainers). Seeds {@code audit_event} rows under two different {@code pool_id}s directly, then
 * reads through {@link AuditEventReader} and asserts each tenant sees only its own rows — one tenant's
 * events never appear in another's page — and that keyset pagination still holds <em>within</em> a
 * tenant's scope (newest-first, cursor-chained, no overlap or gap, {@code null} cursor on the last page).
 *
 * <p>{@code grpc.server.port=0} keeps this context off the fixed gRPC port so it can coexist with other
 * IT contexts. Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=pool-scope-it-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "grpc.server.port=0"
        })
@Import(AuditEventPoolScopeIT.Containers.class)
@DisplayName("AuditEventPoolScopeIT: 실제 PostgreSQL 에서 audit 이벤트를 pool_id 로 테넌트별 스코프하여 읽는지 종단 검증하는 통합테스트")
class AuditEventPoolScopeIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("두 테넌트로 이벤트를 심으면 → 각 테넌트 조회는 자기 pool_id 것만 보고 상대 것은 한 건도 보이지 않는다")
    void readIsScopedToTenantByPoolId() {
        // Method-unique pool ids: the two tests share one context (hence one DB), so distinct ids keep
        // each test's seeded rows from bleeding into the other's scope.
        List<Long> aSeqs = seed("scope-a", 3);
        List<Long> bSeqs = seed("scope-b", 2);
        AuditEventReader reader = new AuditEventReader(dataSource);

        AuditEventPage aPage = reader.page("scope-a", null, 50);
        AuditEventPage bPage = reader.page("scope-b", null, 50);

        // Each tenant sees exactly its own rows, newest-first, and nothing more.
        assertThat(seqsOf(aPage)).containsExactlyElementsOf(descending(aSeqs));
        assertThat(seqsOf(bPage)).containsExactlyElementsOf(descending(bSeqs));
        assertThat(aPage.hasMore()).isFalse();
        assertThat(aPage.nextCursor()).isNull();

        // No cross-tenant leak in either direction.
        assertThat(seqsOf(aPage)).doesNotContainAnyElementsOf(bSeqs);
        assertThat(seqsOf(bPage)).doesNotContainAnyElementsOf(aSeqs);
    }

    @Test
    @DisplayName("한 테넌트 안에서 limit 로 커서를 따라가면 → 그 테넌트 것만 최신순으로 겹침/누락 없이 이어지고 마지막 nextCursor 는 null 이다")
    void keysetHoldsWithinTenantScope() {
        List<Long> aSeqs = seed("keyset-a", 5);
        seed("keyset-b", 4); // noise the walk must never pick up
        AuditEventReader reader = new AuditEventReader(dataSource);

        List<Long> walked = new ArrayList<>();
        Long cursor = null;
        int pages = 0;
        do {
            AuditEventPage page = reader.page("keyset-a", cursor, 2);
            for (AuditEventRecord e : page.events()) {
                walked.add(e.seq());
            }
            cursor = page.nextCursor();
            pages++;
            assertThat(pages).isLessThanOrEqualTo(10); // guard against a runaway cursor loop
        } while (cursor != null);

        assertThat(walked).containsExactlyElementsOf(descending(aSeqs)); // A only, newest-first, no gap/overlap
        assertThat(pages).isEqualTo(3); // 2 + 2 + 1
    }

    /** Inserts {@code count} rows under {@code poolId}; returns their generated seqs in insertion order. */
    private List<Long> seed(String poolId, int count) {
        List<Long> seqs = new ArrayList<>();
        String insert = """
                INSERT INTO audit_event (pool_id, event_type, resource_kind, resource_value, context,
                    occurred_at, until, cause)
                VALUES (?, 'RESOURCE_LEASED', 'PROXY', ?, 'ctx', ?, NULL, NULL)""";
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(insert, new String[] {"seq"})) {
            for (int i = 0; i < count; i++) {
                statement.setString(1, poolId);
                statement.setString(2, poolId + "-res-" + i);
                statement.setLong(3, 1_000_000_000L * (i + 1)); // strictly increasing occurred_at
                statement.executeUpdate();
                try (var keys = statement.getGeneratedKeys()) {
                    assertThat(keys.next()).isTrue();
                    seqs.add(keys.getLong(1));
                }
            }
        } catch (Exception e) {
            throw new IllegalStateException("failed to seed audit_event", e);
        }
        return seqs;
    }

    private static List<Long> seqsOf(AuditEventPage page) {
        return page.events().stream().map(AuditEventRecord::seq).toList();
    }

    /** The seeds newest-first (highest seq first), the order the reader returns them. */
    private static List<Long> descending(List<Long> seqs) {
        List<Long> copy = new ArrayList<>(seqs);
        copy.sort((a, b) -> Long.compare(b, a));
        return copy;
    }
}
