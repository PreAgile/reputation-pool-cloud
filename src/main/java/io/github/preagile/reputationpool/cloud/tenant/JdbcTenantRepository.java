package io.github.preagile.reputationpool.cloud.tenant;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * {@link TenantRepository} over plain JDBC, matching the persistence adapter's no-Spring-JDBC idiom
 * (same as {@code JdbcTenantResolver}). A SQL failure surfaces as an unchecked exception so callers
 * (REST controllers) can translate it, rather than being silently swallowed.
 */
public final class JdbcTenantRepository implements TenantRepository {

    private static final String INSERT = "INSERT INTO tenant (id, name, status, created_at) VALUES (?, ?, ?, ?)";
    private static final String SELECT_ALL = "SELECT id, name, status, created_at FROM tenant ORDER BY created_at";
    private static final String SELECT_BY_ID = "SELECT id, name, status, created_at FROM tenant WHERE id = ?";
    private static final String UPDATE_STATUS = "UPDATE tenant SET status = ? WHERE id = ?";
    private static final String TOMBSTONE = "UPDATE tenant SET status = 'deleted' WHERE id = ?";

    // Every table scoped to a single tenant. The cloud-owned tables key on tenant_id; the upstream pool
    // tables key on pool_id (= tenant id, per V3/V5). cell_outcome is listed before cell only for clarity
    // — the cell -> cell_outcome ON DELETE CASCADE (per pool_id) would remove it either way. The tenant
    // row itself is NOT here: it is tombstoned to 'deleted' rather than deleted, so the deletion is
    // auditable.
    private static final String[] DELETE_SCOPED = {
        "DELETE FROM api_key WHERE tenant_id = ?",
        "DELETE FROM usage_meter WHERE tenant_id = ?",
        "DELETE FROM score_sample WHERE tenant_id = ?",
        "DELETE FROM cell_outcome WHERE pool_id = ?",
        "DELETE FROM cell WHERE pool_id = ?",
        "DELETE FROM blocklist_entry WHERE pool_id = ?",
        "DELETE FROM registered_resource WHERE pool_id = ?",
        "DELETE FROM snapshot_meta WHERE pool_id = ?",
        "DELETE FROM audit_event WHERE pool_id = ?"
    };

    private final DataSource dataSource;

    public JdbcTenantRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    @Override
    public void create(Tenant tenant) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(INSERT)) {
            statement.setString(1, tenant.id());
            statement.setString(2, tenant.name());
            statement.setString(3, tenant.status().toDb());
            statement.setTimestamp(4, Timestamp.from(tenant.createdAt()));
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("tenant create failed", e);
        }
    }

    @Override
    public List<Tenant> findAll() {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_ALL);
                ResultSet rows = statement.executeQuery()) {
            List<Tenant> tenants = new ArrayList<>();
            while (rows.next()) {
                tenants.add(map(rows));
            }
            return tenants;
        } catch (SQLException e) {
            throw new IllegalStateException("tenant list failed", e);
        }
    }

    @Override
    public Optional<Tenant> findById(String id) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_BY_ID)) {
            statement.setString(1, id);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next() ? Optional.of(map(rows)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("tenant lookup failed", e);
        }
    }

    @Override
    public void updateStatus(String id, TenantStatus status) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(UPDATE_STATUS)) {
            statement.setString(1, status.toDb());
            statement.setString(2, id);
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("tenant status update failed", e);
        }
    }

    @Override
    public void deleteTenantData(String id) {
        Connection connection = null;
        try {
            connection = dataSource.getConnection();
            connection.setAutoCommit(false);
            for (String sql : DELETE_SCOPED) {
                try (PreparedStatement statement = connection.prepareStatement(sql)) {
                    statement.setString(1, id);
                    statement.executeUpdate();
                }
            }
            // Tombstone the tenant row in the same transaction, so the scoped hard-delete and the soft
            // DELETED marker are atomic: a caller never sees a tenant deleted-but-still-active or
            // active-but-data-gone.
            try (PreparedStatement statement = connection.prepareStatement(TOMBSTONE)) {
                statement.setString(1, id);
                statement.executeUpdate();
            }
            connection.commit();
        } catch (SQLException e) {
            rollbackQuietly(connection);
            throw new IllegalStateException("tenant delete failed", e);
        } finally {
            closeQuietly(connection);
        }
    }

    private static void rollbackQuietly(Connection connection) {
        if (connection == null) {
            return;
        }
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // The primary failure is already being propagated; a rollback failure must not mask it.
        }
    }

    private static void closeQuietly(Connection connection) {
        if (connection == null) {
            return;
        }
        try {
            connection.setAutoCommit(true);
            connection.close();
        } catch (SQLException ignored) {
            // Closing is best-effort; the pool will discard a bad connection.
        }
    }

    private static Tenant map(ResultSet rows) throws SQLException {
        return new Tenant(
                rows.getString("id"),
                rows.getString("name"),
                TenantStatus.fromDb(rows.getString("status")),
                rows.getTimestamp("created_at").toInstant());
    }
}
