package io.github.preagile.reputationpool.cloud.readmodel;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.sql.DataSource;

/**
 * Reads the hourly per-context reputation rollup ({@code score_rollup_hourly}) for the dashboard's
 * context curve. Plain JDBC, matching the persistence adapter's idiom (like {@link ScoreHistoryReader},
 * which reads the same underlying signal along the resource axis).
 *
 * <p><b>Why not aggregate {@code score_sample} directly.</b> That table carries one row per
 * (tenant × resource × context) per sample tick — roughly 4GB for its 7-day retention on production — so
 * a {@code GROUP BY context} over a 30-day range would be both an unbounded scan and, past 7 days, empty:
 * the raw rows are purged well before the window the dashboard offers. {@code ScoreSampler} therefore
 * folds each tick into an hourly bucket as it writes, and this reader serves the long windows from those
 * buckets, whose cardinality is (tenant × context × hour).
 *
 * <p>Every query is scoped by the server-decided {@code tenant_id} (the JWT's tenant, never a request
 * parameter). Rows come back ordered by {@code (context, bucket_hour)} so a single pass groups them into
 * one ascending-time series per context — the shape the chart renders directly, one line per context.
 */
public final class ContextRollupReader {

    private static final String SELECT_HISTORY =
            "SELECT context, bucket_hour, score_sum, sample_count, min_score, max_score, cells"
                    + " FROM score_rollup_hourly WHERE tenant_id = ? AND bucket_hour >= ?"
                    + " ORDER BY context, bucket_hour";

    private final DataSource dataSource;

    public ContextRollupReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * Every context's hourly score series since {@code since}, oldest point first within each context.
     *
     * @param tenantId the server-decided tenant (from the JWT)
     * @param since the inclusive lower bound on bucket time (the window start)
     */
    public ContextHistory read(String tenantId, Instant since) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(since, "since must not be null");
        // The ORDER BY delivers rows already grouped and time-ordered; a LinkedHashMap preserves that
        // order and lets each row append to its context's series in one pass.
        Map<String, List<ContextPoint>> byContext = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_HISTORY)) {
            statement.setString(1, tenantId);
            statement.setTimestamp(2, Timestamp.from(since));
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    byContext
                            .computeIfAbsent(rows.getString("context"), context -> new ArrayList<>())
                            .add(pointOf(rows));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("context rollup query failed", e);
        }
        List<ContextSeries> contexts = new ArrayList<>();
        byContext.forEach((context, points) -> contexts.add(new ContextSeries(context, points)));
        return new ContextHistory(contexts);
    }

    /**
     * One bucket row as a chart point. The bucket stores a sum and a count rather than an average (an
     * average cannot be merged with a new observation without its weight), so the mean is divided out
     * here. A zero {@code sample_count} is impossible for a written row, but is guarded so a corrupt row
     * yields {@code 0.0} instead of {@code NaN} poisoning the whole series.
     */
    private static ContextPoint pointOf(ResultSet rows) throws SQLException {
        long samples = rows.getLong("sample_count");
        double sum = rows.getDouble("score_sum");
        return new ContextPoint(
                rows.getTimestamp("bucket_hour").toInstant(),
                samples > 0 ? sum / samples : 0.0,
                rows.getDouble("min_score"),
                rows.getDouble("max_score"),
                rows.getInt("cells"));
    }

    /** Every context's curve over the requested window, one series per context. */
    public record ContextHistory(List<ContextSeries> contexts) {}

    /** One context's ascending-time hourly points. */
    public record ContextSeries(String context, List<ContextPoint> points) {}

    /**
     * One hour of one context: the mean score across every sample in the bucket, the spread, and the cell
     * count at the last tick of the hour.
     */
    public record ContextPoint(Instant at, double averageScore, double minScore, double maxScore, int cells) {}
}
