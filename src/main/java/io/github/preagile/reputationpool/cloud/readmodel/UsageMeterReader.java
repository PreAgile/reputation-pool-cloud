package io.github.preagile.reputationpool.cloud.readmodel;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import javax.sql.DataSource;

/**
 * Reads a tenant's usage meters for the dashboard (issue #10), from the cloud-owned {@code usage_meter}
 * table. Plain JDBC, matching the persistence adapter's idiom (like {@link AuditEventReader}). All
 * queries are scoped by {@code tenant_id} — the caller passes the server-decided tenant from the JWT.
 */
public final class UsageMeterReader {

    private static final String DAILY_LEASES = "SELECT period_start, value FROM usage_meter"
            + " WHERE tenant_id = ? AND metric = 'lease' AND period_start >= ?"
            + " ORDER BY period_start";
    private static final String MONTH_LEASE_TOTAL = "SELECT COALESCE(SUM(value), 0) FROM usage_meter"
            + " WHERE tenant_id = ? AND metric = 'lease' AND period_start >= ?";
    private static final String LATEST_POOL_SIZE = "SELECT value FROM usage_meter"
            + " WHERE tenant_id = ? AND metric = 'pool_size' ORDER BY period_start DESC LIMIT 1";

    private final DataSource dataSource;

    public UsageMeterReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * The tenant's usage as of {@code today} (UTC): the last {@code days} days of daily lease counts, the
     * current calendar month's lease total, and the most recently sampled pool size.
     *
     * <p>{@code days} is the caller's window, not a fixed 30: the dashboard's range picker drives it, so a
     * 90-day view is one query rather than a client-side slice of whatever the server felt like sending.
     * The meter table is one row per (tenant × metric × day), so a long window is still a small scan.
     *
     * @param days how many days of daily counts to return, counting back from {@code today} inclusive
     */
    public UsageSummary read(String tenantId, LocalDate today, int days) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        if (days < 1) {
            throw new IllegalArgumentException("days must be at least 1");
        }
        try (Connection connection = dataSource.getConnection()) {
            List<DailyLease> daily = dailyLeases(connection, tenantId, today.minusDays(days - 1L));
            long monthTotal = monthLeaseTotal(connection, tenantId, today.withDayOfMonth(1));
            long poolSize = latestPoolSize(connection, tenantId);
            return new UsageSummary(monthTotal, poolSize, daily);
        } catch (SQLException e) {
            throw new IllegalStateException("usage read failed", e);
        }
    }

    private List<DailyLease> dailyLeases(Connection connection, String tenantId, LocalDate since) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(DAILY_LEASES)) {
            statement.setString(1, tenantId);
            statement.setObject(2, since);
            try (ResultSet rows = statement.executeQuery()) {
                List<DailyLease> daily = new ArrayList<>();
                while (rows.next()) {
                    daily.add(new DailyLease(rows.getObject(1, LocalDate.class), rows.getLong(2)));
                }
                return daily;
            }
        }
    }

    private long monthLeaseTotal(Connection connection, String tenantId, LocalDate monthStart) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(MONTH_LEASE_TOTAL)) {
            statement.setString(1, tenantId);
            statement.setObject(2, monthStart);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next() ? rows.getLong(1) : 0L;
            }
        }
    }

    private long latestPoolSize(Connection connection, String tenantId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(LATEST_POOL_SIZE)) {
            statement.setString(1, tenantId);
            try (ResultSet rows = statement.executeQuery()) {
                return rows.next() ? rows.getLong(1) : 0L;
            }
        }
    }

    /** A tenant's usage snapshot for the dashboard. */
    public record UsageSummary(long monthLeaseTotal, long poolSize, List<DailyLease> dailyLeases) {}

    /** One day's granted-lease count. */
    public record DailyLease(LocalDate date, long count) {}
}
