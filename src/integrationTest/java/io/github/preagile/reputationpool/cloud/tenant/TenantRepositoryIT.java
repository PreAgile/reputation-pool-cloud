package io.github.preagile.reputationpool.cloud.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
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
 * Integration test (Testcontainers PostgreSQL) for {@link TenantRepository} against the real
 * {@code tenant} table (migration V100). The startup seeder has already created the {@code default}
 * tenant, so this also proves the table + repository line up end to end.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@DisplayName("TenantRepositoryIT: 실제 PostgreSQL 의 tenant 테이블에서 저장/조회/목록이 동작하는지 검증하는 통합테스트")
@SpringBootTest(properties = {"reputation-pool.auth.api-key=it-key", "grpc.server.port=0"})
@Import(TenantRepositoryIT.Containers.class)
class TenantRepositoryIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private TenantRepository repository;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("테넌트를 저장하면 id 로 조회되고 없는 id 는 비며, 목록엔 → 시드된 default 와 방금 만든 acme 가 함께 나온다")
    void createsFindsAndLists() {
        repository.create(new Tenant(
                "acme",
                "Acme Corp",
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                Instant.parse("2026-07-17T00:00:00Z")));

        assertThat(repository.findById("acme")).get().extracting(Tenant::name).isEqualTo("Acme Corp");
        assertThat(repository.findById("missing")).isEmpty();
        // "default" is seeded at startup from REPUTATION_POOL_API_KEY; "acme" is the row just created.
        assertThat(repository.findAll()).extracting(Tenant::id).contains("default", "acme");
    }

    @Test
    @DisplayName(
            "테넌트를 삭제하면 → 스코프 데이터(api_key·usage_meter·score_sample 등)가 전부 지워지고 tenant 행은 status='deleted' 툼스톤으로 남는다(#83)")
    void deleteTenantData_purgesScopedRowsAndTombstonesTheTenant() throws Exception {
        repository.create(new Tenant(
                "delco",
                "Delete Co",
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE,
                Instant.parse("2026-07-17T00:00:00Z")));
        seedApiKey("delco");
        seedUsageMeter("delco");
        seedScoreSample("delco");
        // Sanity: the scoped rows exist before delete.
        assertThat(rowCount("SELECT count(*) FROM api_key WHERE tenant_id = 'delco'"))
                .isEqualTo(1);
        assertThat(rowCount("SELECT count(*) FROM usage_meter WHERE tenant_id = 'delco'"))
                .isEqualTo(1);
        assertThat(rowCount("SELECT count(*) FROM score_sample WHERE tenant_id = 'delco'"))
                .isEqualTo(1);

        // deleteTenantData executes all ten scoped DELETEs against the real schema in one transaction —
        // its success alone proves every table/column (incl. the upstream pool_id tables) is valid SQL.
        assertThat(repository.deleteTenantData(
                        "delco", io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE))
                .isTrue();

        assertThat(rowCount("SELECT count(*) FROM api_key WHERE tenant_id = 'delco'"))
                .isZero();
        assertThat(rowCount("SELECT count(*) FROM usage_meter WHERE tenant_id = 'delco'"))
                .isZero();
        assertThat(rowCount("SELECT count(*) FROM score_sample WHERE tenant_id = 'delco'"))
                .isZero();
        // The tenant row survives as a DELETED tombstone (soft), so the deletion stays auditable.
        assertThat(repository.findById("delco"))
                .get()
                .extracting(Tenant::status)
                .isEqualTo(io.github.preagile.reputationpool.cloud.tenant.TenantStatus.DELETED);
        // Another tenant's rows are untouched (isolation): the seeded default still resolves.
        assertThat(repository.findById("default")).isPresent();
    }

    private void seedApiKey(String tenantId) throws Exception {
        try (Connection c = dataSource.getConnection();
                PreparedStatement s = c.prepareStatement(
                        "INSERT INTO api_key (key_hash, tenant_id, label, created_at) VALUES (?, ?, ?, ?)")) {
            s.setBytes(1, ("hash-" + tenantId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            s.setString(2, tenantId);
            s.setString(3, "seed");
            s.setTimestamp(4, Timestamp.from(Instant.parse("2026-07-17T00:00:00Z")));
            s.executeUpdate();
        }
    }

    private void seedUsageMeter(String tenantId) throws Exception {
        try (Connection c = dataSource.getConnection();
                PreparedStatement s = c.prepareStatement(
                        "INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)"
                                + " VALUES (?, 'lease', ?, 1, ?)")) {
            s.setString(1, tenantId);
            s.setObject(2, LocalDate.parse("2026-07-17"));
            s.setTimestamp(3, Timestamp.from(Instant.parse("2026-07-17T00:00:00Z")));
            s.executeUpdate();
        }
    }

    private void seedScoreSample(String tenantId) throws Exception {
        try (Connection c = dataSource.getConnection();
                PreparedStatement s = c.prepareStatement(
                        "INSERT INTO score_sample (tenant_id, resource_kind, resource_value, context, sampled_at, score)"
                                + " VALUES (?, 'PROXY', 'p1', 'GLOBAL', ?, 0.5)")) {
            s.setString(1, tenantId);
            s.setTimestamp(2, Timestamp.from(Instant.parse("2026-07-17T00:00:00Z")));
            s.executeUpdate();
        }
    }

    private long rowCount(String sql) throws Exception {
        try (Connection c = dataSource.getConnection();
                PreparedStatement s = c.prepareStatement(sql);
                ResultSet rs = s.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }
}
