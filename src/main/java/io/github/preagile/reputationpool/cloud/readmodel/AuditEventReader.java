package io.github.preagile.reputationpool.cloud.readmodel;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import javax.sql.DataSource;

/**
 * Reads the {@code audit_event} ledger for the dashboard (issue #11). The persistence adapter's
 * {@code PostgresAuditTrail} is write-only (an append-only sink with no query surface — the reference
 * server never needed to read it back), so cloud owns this read side as its own plain-JDBC query,
 * matching the adapter's idiom.
 *
 * <p>Pages newest-first by {@code seq} (the total order the ledger is written in) using
 * {@code LIMIT ? OFFSET ?} — classic offset pagination. It fetches one extra row to report
 * {@code hasMore} cheaply rather than issuing a {@code COUNT(*)}. Note this is <em>not</em> keyset
 * pagination: {@code OFFSET n} still makes the database walk and discard the first {@code n} rows, so
 * cost grows with the page offset and deep pages get progressively slower. True keyset pagination (a
 * {@code seq < ?} cursor that seeks instead of skipping) is deferred follow-up work.
 *
 * <p><b>Tenant-scope caveat.</b> {@code audit_event} carries no tenant/pool column yet — the trail is
 * a shared broadcaster fed by the single interim pool — so events are currently <em>global</em>, not
 * tenant-scoped. This mirrors the {@code TenantPoolRegistry} single-pool limitation; per-tenant
 * event isolation is follow-up work (tracked with #9b). The reader deliberately does not pretend to
 * filter by tenant it cannot yet distinguish.
 */
public final class AuditEventReader {

    private static final long NANOS_PER_SECOND = 1_000_000_000L;

    private static final String SELECT_PAGE = """
            SELECT seq, event_type, resource_kind, resource_value, context, occurred_at, until, cause
            FROM audit_event ORDER BY seq DESC LIMIT ? OFFSET ?""";

    private final DataSource dataSource;

    public AuditEventReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * One page of the ledger, newest first.
     *
     * @param page zero-based page index
     * @param size page size (rows per page)
     */
    public AuditEventPage page(int page, int size) {
        int safeSize = Math.max(1, Math.min(size, 500));
        int safePage = Math.max(0, page);
        long offset = (long) safePage * safeSize;
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_PAGE)) {
            statement.setInt(1, safeSize + 1); // one extra row => hasMore without a COUNT(*)
            statement.setLong(2, offset);
            try (ResultSet rows = statement.executeQuery()) {
                List<AuditEventRecord> events = new ArrayList<>();
                while (rows.next()) {
                    events.add(map(rows));
                }
                boolean hasMore = events.size() > safeSize;
                if (hasMore) {
                    events.remove(events.size() - 1);
                }
                return new AuditEventPage(events, safePage, safeSize, hasMore);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("audit event query failed", e);
        }
    }

    private static AuditEventRecord map(ResultSet rows) throws SQLException {
        long until = rows.getLong("until");
        boolean untilNull = rows.wasNull();
        return new AuditEventRecord(
                rows.getLong("seq"),
                rows.getString("event_type"),
                rows.getString("resource_kind"),
                rows.getString("resource_value"),
                rows.getString("context"),
                epochNanosToInstant(rows.getLong("occurred_at")),
                untilNull ? null : epochNanosToInstant(until),
                rows.getString("cause"));
    }

    /** Epoch-nanosecond bigint (the ledger's lossless time column) back to an {@link Instant}. */
    private static Instant epochNanosToInstant(long epochNanos) {
        return Instant.ofEpochSecond(
                Math.floorDiv(epochNanos, NANOS_PER_SECOND), Math.floorMod(epochNanos, NANOS_PER_SECOND));
    }

    /** One audit row, times decoded to {@link Instant}. {@code context}/{@code until}/{@code cause} may be null. */
    public record AuditEventRecord(
            long seq,
            String eventType,
            String resourceKind,
            String resourceValue,
            String context,
            Instant occurredAt,
            Instant until,
            String cause) {}

    /** A page of events, newest first, with a cheap {@code hasMore} instead of a total count. */
    public record AuditEventPage(List<AuditEventRecord> events, int page, int size, boolean hasMore) {}
}
