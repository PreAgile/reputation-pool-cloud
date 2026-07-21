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
 * <p>Pages newest-first by {@code seq} (the total order the ledger is written in) with <b>keyset
 * (cursor) pagination</b> (issue #30): the first page is the latest {@code limit} rows, and each
 * subsequent page is {@code WHERE seq < :beforeSeq ORDER BY seq DESC LIMIT :limit}. Because {@code seq}
 * is the {@code IDENTITY} primary key, this is a bounded reverse index scan that <em>seeks</em> to the
 * cursor rather than an {@code OFFSET} that walks and discards leading rows — cost is flat regardless of
 * how deep the caller has scrolled. It fetches one extra row to report {@code hasMore} (and expose the
 * {@code nextCursor}) cheaply rather than issuing a {@code COUNT(*)}. No new column, migration, or index
 * is needed: the PK already provides the ordered access path.
 *
 * <p>Purging ({@code PostgresAuditTrail.purgeOlderThan}) deletes the <em>oldest</em> (lowest-{@code seq})
 * tail, which is the opposite end from where a newest-first cursor walks, so a concurrent purge cannot
 * make a live cursor skip or duplicate rows.
 *
 * <p><b>Tenant-scope caveat.</b> {@code audit_event} carries no tenant/pool column yet — the trail is
 * a shared broadcaster fed by the single interim pool — so events are currently <em>global</em>, not
 * tenant-scoped. This mirrors the {@code TenantPoolRegistry} single-pool limitation; per-tenant
 * event isolation is follow-up work (tracked with #9b). The reader deliberately does not pretend to
 * filter by tenant it cannot yet distinguish.
 */
public final class AuditEventReader {

    private static final long NANOS_PER_SECOND = 1_000_000_000L;

    /** Hard ceiling on a single page, independent of what the caller asks for. */
    private static final int MAX_LIMIT = 500;

    private static final String SELECT_LATEST = """
            SELECT seq, event_type, resource_kind, resource_value, context, occurred_at, until, cause
            FROM audit_event ORDER BY seq DESC LIMIT ?""";

    private static final String SELECT_BEFORE = """
            SELECT seq, event_type, resource_kind, resource_value, context, occurred_at, until, cause
            FROM audit_event WHERE seq < ? ORDER BY seq DESC LIMIT ?""";

    private final DataSource dataSource;

    public AuditEventReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * One page of the ledger, newest first, via keyset pagination.
     *
     * @param beforeSeq exclusive upper bound on {@code seq}: {@code null} means "start at the latest",
     *     otherwise the page holds the newest rows with {@code seq < beforeSeq}
     * @param limit page size (rows per page), clamped to {@code [1, 500]}
     * @return the page; {@link AuditEventPage#nextCursor()} is the {@code seq} to pass as the next
     *     {@code beforeSeq}, or {@code null} when this is the last page
     */
    public AuditEventPage page(Long beforeSeq, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = prepare(connection, beforeSeq, safeLimit)) {
            try (ResultSet rows = statement.executeQuery()) {
                List<AuditEventRecord> events = new ArrayList<>();
                while (rows.next()) {
                    events.add(map(rows));
                }
                boolean hasMore = events.size() > safeLimit;
                if (hasMore) {
                    events.remove(events.size() - 1); // drop the probe row
                }
                // Cursor = seq of the last (oldest) row on this page; null when nothing more follows.
                Long nextCursor = hasMore ? events.get(events.size() - 1).seq() : null;
                return new AuditEventPage(events, nextCursor, hasMore);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("audit event query failed", e);
        }
    }

    /** Latest-page vs before-cursor query, both fetching one probe row past {@code limit}. */
    private static PreparedStatement prepare(Connection connection, Long beforeSeq, int limit) throws SQLException {
        if (beforeSeq == null) {
            PreparedStatement statement = connection.prepareStatement(SELECT_LATEST);
            statement.setInt(1, limit + 1);
            return statement;
        }
        PreparedStatement statement = connection.prepareStatement(SELECT_BEFORE);
        statement.setLong(1, beforeSeq);
        statement.setInt(2, limit + 1);
        return statement;
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

    /**
     * A page of events, newest first. {@code nextCursor} is the {@code seq} to seek before for the next
     * page, or {@code null} when the page is the last one; {@code hasMore} mirrors {@code nextCursor != null}.
     */
    public record AuditEventPage(List<AuditEventRecord> events, Long nextCursor, boolean hasMore) {}
}
