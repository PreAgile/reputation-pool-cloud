package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.Objects;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Bridges the single-key env UX (issue #4) onto the table-backed model (issue #9): when
 * {@code REPUTATION_POOL_API_KEY} is set and {@code api_key} is still empty, it seeds the
 * {@link TenantContext#DEFAULT_TENANT default} tenant plus that one key on startup. Idempotent — a
 * non-empty table is left untouched — so restarts and later key management (#11) are safe. When no key
 * is configured it seeds nothing, leaving the table empty so the interceptor rejects every call (fail
 * closed), exactly as before.
 *
 * <p>Runs as an {@link ApplicationRunner}, i.e. after Flyway has migrated the schema and the context is
 * built. A request arriving in the brief window before it completes is rejected (empty table), never
 * wrongly admitted — the failure mode stays closed.
 */
public final class ApiKeySeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ApiKeySeeder.class);

    private final DataSource dataSource;
    private final SecurityProperties properties;
    private final Clock clock;

    public ApiKeySeeder(DataSource dataSource, SecurityProperties properties, Clock clock) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @Override
    public void run(ApplicationArguments args) throws SQLException {
        if (!properties.configured()) {
            log.warn("no reputation-pool.auth.api-key configured — seeded no key; all gRPC calls rejected (fail closed)");
            return;
        }
        try (Connection connection = dataSource.getConnection()) {
            if (hasAnyKey(connection)) {
                return; // already seeded or managed elsewhere — leave it alone
            }
            Timestamp now = Timestamp.from(clock.instant());
            insertDefaultTenant(connection, now);
            insertKey(connection, ApiKeyHashing.sha256(properties.apiKey()), now);
            log.info("seeded default tenant + API key from REPUTATION_POOL_API_KEY");
        }
    }

    private static boolean hasAnyKey(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT 1 FROM api_key LIMIT 1");
                ResultSet rows = statement.executeQuery()) {
            return rows.next();
        }
    }

    private static void insertDefaultTenant(Connection connection, Timestamp now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO tenant (id, name, status, created_at) VALUES (?, ?, 'active', ?)"
                        + " ON CONFLICT (id) DO NOTHING")) {
            statement.setString(1, TenantContext.DEFAULT_TENANT);
            statement.setString(2, TenantContext.DEFAULT_TENANT);
            statement.setTimestamp(3, now);
            statement.executeUpdate();
        }
    }

    private static void insertKey(Connection connection, byte[] keyHash, Timestamp now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO api_key (key_hash, tenant_id, label, created_at) VALUES (?, ?, ?, ?)")) {
            statement.setBytes(1, keyHash);
            statement.setString(2, TenantContext.DEFAULT_TENANT);
            statement.setString(3, "seed:REPUTATION_POOL_API_KEY");
            statement.setTimestamp(4, now);
            statement.executeUpdate();
        }
    }
}
