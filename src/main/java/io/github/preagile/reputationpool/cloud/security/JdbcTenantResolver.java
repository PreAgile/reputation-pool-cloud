package io.github.preagile.reputationpool.cloud.security;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Objects;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * A {@link TenantResolver} over plain JDBC — matching the persistence adapter's no-Spring-JDBC idiom.
 * Looks the SHA-256 key hash up in {@code api_key}, skipping revoked rows, and returns the mapped
 * tenant. A SQL failure surfaces as an unchecked exception so the interceptor can fail the call with
 * {@code UNAVAILABLE} rather than silently treat a database outage as an auth rejection.
 *
 * <p><b>Suspend/delete access block (issue #83).</b> The lookup additionally requires the key's tenant
 * to be {@code active}: a suspended or deleted tenant resolves to nothing, so its gRPC calls fail closed
 * with {@code UNAUTHENTICATED} at {@code ApiKeyAuthInterceptor} even though the key itself is still
 * valid and unrevoked. This is the data-plane half of the lifecycle — the control plane is a single v1
 * admin, so this hash-time check is what actually stops a frozen tenant's traffic.
 */
public final class JdbcTenantResolver implements TenantResolver {

    private static final String LOOKUP = "SELECT tenant_id FROM api_key WHERE key_hash = ? AND revoked_at IS NULL"
            + " AND EXISTS (SELECT 1 FROM tenant t WHERE t.id = api_key.tenant_id AND t.status = 'active')";

    private final DataSource dataSource;

    public JdbcTenantResolver(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    @Override
    public Optional<String> resolveByKeyHash(byte[] keyHash) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(LOOKUP)) {
            statement.setBytes(1, keyHash);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next() ? Optional.of(rows.getString(1)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("tenant lookup failed", e);
        }
    }
}
