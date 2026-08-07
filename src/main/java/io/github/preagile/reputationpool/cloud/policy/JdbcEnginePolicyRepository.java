package io.github.preagile.reputationpool.cloud.policy;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * {@link EnginePolicyRepository} over plain JDBC, matching the persistence adapter's no-Spring-JDBC
 * idiom (same as {@code JdbcTenantRepository}). A SQL failure surfaces as an unchecked exception so
 * callers can translate it, rather than being silently swallowed.
 */
public final class JdbcEnginePolicyRepository implements EnginePolicyRepository {

    private static final String UNIQUE_VIOLATION = "23505";

    private static final String COLUMNS = "tenant_id, revision, window_size, cool_after, recover_after, "
            + "lease_ttl_millis, cooldown_max_exponent, exploration_floor, changed_by, changed_at";

    private static final String SELECT_CURRENT =
            "SELECT " + COLUMNS + " FROM tenant_engine_policy WHERE tenant_id = ? ORDER BY revision DESC LIMIT 1";

    private static final String SELECT_HISTORY =
            "SELECT " + COLUMNS + " FROM tenant_engine_policy WHERE tenant_id = ? ORDER BY revision DESC LIMIT ?";

    private static final String SELECT_NEXT_REVISION =
            "SELECT coalesce(max(revision), 0) + 1 FROM tenant_engine_policy WHERE tenant_id = ?";

    private static final String INSERT =
            "INSERT INTO tenant_engine_policy (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    private final DataSource dataSource;

    public JdbcEnginePolicyRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    @Override
    public Optional<EnginePolicyRevision> findCurrent(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_CURRENT)) {
            statement.setString(1, tenantId);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next() ? Optional.of(map(rows)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("engine policy lookup failed", e);
        }
    }

    @Override
    public EnginePolicyRevision append(String tenantId, EnginePolicy policy, String changedBy, Instant changedAt) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(policy, "policy must not be null");
        Objects.requireNonNull(changedBy, "changedBy must not be null");
        Objects.requireNonNull(changedAt, "changedAt must not be null");
        // Read the next revision and insert it in one transaction. The read does not make the allocation
        // atomic — two writers can still read the same number — and it is not meant to: the
        // (tenant_id, revision) primary key is what decides that race, and the loser is told to re-read
        // rather than silently overwriting a change it never saw. Nothing here updates an existing row,
        // so there is no lost update to guard against beyond that.
        try (Connection connection = dataSource.getConnection()) {
            int revision = nextRevision(connection, tenantId);
            try (PreparedStatement statement = connection.prepareStatement(INSERT)) {
                statement.setString(1, tenantId);
                statement.setInt(2, revision);
                statement.setInt(3, policy.windowSize());
                statement.setInt(4, policy.coolAfter());
                statement.setInt(5, policy.recoverAfter());
                statement.setLong(6, policy.leaseTtl().toMillis());
                statement.setInt(7, policy.cooldownMaxExponent());
                statement.setDouble(8, policy.explorationFloor());
                statement.setString(9, changedBy);
                statement.setTimestamp(10, Timestamp.from(changedAt));
                statement.executeUpdate();
            }
            return new EnginePolicyRevision(tenantId, revision, policy, changedBy, changedAt);
        } catch (SQLException e) {
            if (UNIQUE_VIOLATION.equals(e.getSQLState())) {
                throw new EnginePolicyConflictException("engine policy was concurrently changed, retry", e);
            }
            throw new IllegalStateException("engine policy write failed", e);
        }
    }

    private static int nextRevision(Connection connection, String tenantId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(SELECT_NEXT_REVISION)) {
            statement.setString(1, tenantId);
            try (ResultSet rows = statement.executeQuery()) {
                // max() over an empty set still yields one row, so this always reads a value.
                rows.next();
                return rows.getInt(1);
            }
        }
    }

    @Override
    public List<EnginePolicyRevision> history(String tenantId, int limit) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be >= 1, but was " + limit);
        }
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_HISTORY)) {
            statement.setString(1, tenantId);
            statement.setInt(2, limit);
            try (ResultSet rows = statement.executeQuery()) {
                List<EnginePolicyRevision> revisions = new ArrayList<>();
                while (rows.next()) {
                    revisions.add(map(rows));
                }
                return revisions;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("engine policy history lookup failed", e);
        }
    }

    private static EnginePolicyRevision map(ResultSet rows) throws SQLException {
        EnginePolicy policy = new EnginePolicy(
                rows.getInt("window_size"),
                rows.getInt("cool_after"),
                rows.getInt("recover_after"),
                Duration.ofMillis(rows.getLong("lease_ttl_millis")),
                rows.getInt("cooldown_max_exponent"),
                rows.getDouble("exploration_floor"));
        return new EnginePolicyRevision(
                rows.getString("tenant_id"),
                rows.getInt("revision"),
                policy,
                rows.getString("changed_by"),
                rows.getTimestamp("changed_at").toInstant());
    }
}
