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
            statement.setString(3, tenant.status());
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

    private static Tenant map(ResultSet rows) throws SQLException {
        return new Tenant(
                rows.getString("id"),
                rows.getString("name"),
                rows.getString("status"),
                rows.getTimestamp("created_at").toInstant());
    }
}
