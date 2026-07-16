package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
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
 * Bridges the single-key env UX (issue #4) onto the table-backed model (issue #9): on startup it
 * reconciles the {@link TenantContext#DEFAULT_TENANT default} tenant's seed key to match
 * {@code REPUTATION_POOL_API_KEY}. Reconcile, not seed-once, so it does three jobs at once:
 *
 * <ul>
 *   <li><b>Idempotent + concurrency-safe.</b> Both writes use {@code ON CONFLICT}, so two instances
 *       cold-starting together (or any restart) converge instead of one failing on a duplicate key —
 *       there is no check-then-act race.
 *   <li><b>Rotation.</b> Changing the env key activates the new key ({@code ON CONFLICT DO UPDATE}
 *       clears any stale {@code revoked_at}) and revokes the previously seeded key, so the env var is
 *       the single source of truth for the default tenant's bootstrap key — both A&rarr;B and B&rarr;A.
 *   <li><b>Fail closed.</b> When no key is configured it writes nothing and leaves existing rows
 *       alone (an accidental unset must not lock the service out), so an unseeded table rejects every
 *       call.
 * </ul>
 *
 * <p>Scope: it only ever touches {@code label LIKE 'seed:%'} rows, so per-tenant keys minted by the
 * control plane (#11) are never revoked here. Full multi-tenant key management is #11; this is just
 * the bootstrap key. Runs as an {@link ApplicationRunner}, i.e. after Flyway has migrated; a request
 * in the brief window before it completes is rejected (empty/stale), never wrongly admitted.
 */
public final class ApiKeySeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ApiKeySeeder.class);

    private static final String SEED_LABEL = "seed:REPUTATION_POOL_API_KEY";

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
        byte[] keyHash = ApiKeyHashing.sha256(properties.apiKey());
        Timestamp now = Timestamp.from(clock.instant());
        try (Connection connection = dataSource.getConnection()) {
            upsertDefaultTenant(connection, now);
            activateKey(connection, keyHash, now);
            int revoked = revokeOtherSeedKeys(connection, keyHash, now);
            if (revoked > 0) {
                log.info("rotated default tenant API key from REPUTATION_POOL_API_KEY (revoked {} prior seed key(s))", revoked);
            }
        }
    }

    private static void upsertDefaultTenant(Connection connection, Timestamp now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO tenant (id, name, status, created_at) VALUES (?, ?, 'active', ?)"
                        + " ON CONFLICT (id) DO NOTHING")) {
            statement.setString(1, TenantContext.DEFAULT_TENANT);
            statement.setString(2, TenantContext.DEFAULT_TENANT);
            statement.setTimestamp(3, now);
            statement.executeUpdate();
        }
    }

    /** Inserts the key, or re-activates it if a (possibly revoked) row already exists for this hash. */
    private static void activateKey(Connection connection, byte[] keyHash, Timestamp now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO api_key (key_hash, tenant_id, label, created_at) VALUES (?, ?, ?, ?)"
                        + " ON CONFLICT (key_hash) DO UPDATE SET revoked_at = NULL")) {
            statement.setBytes(1, keyHash);
            statement.setString(2, TenantContext.DEFAULT_TENANT);
            statement.setString(3, SEED_LABEL);
            statement.setTimestamp(4, now);
            statement.executeUpdate();
        }
    }

    /** Revokes every other seed key of the default tenant, so the env var is the one active seed key. */
    private static int revokeOtherSeedKeys(Connection connection, byte[] keyHash, Timestamp now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "UPDATE api_key SET revoked_at = ? WHERE tenant_id = ? AND label = ?"
                        + " AND key_hash <> ? AND revoked_at IS NULL")) {
            statement.setTimestamp(1, now);
            statement.setString(2, TenantContext.DEFAULT_TENANT);
            statement.setString(3, SEED_LABEL);
            statement.setBytes(4, keyHash);
            return statement.executeUpdate();
        }
    }
}
