package io.github.preagile.reputationpool.cloud.readmodel;

import io.github.preagile.reputationpool.core.domain.FailureType;
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
 * Reads the hourly per-context outcome rollup ({@code report_outcome_hourly}) for the dashboard's success
 * rate (issue #189) — {@link ContextRollupReader}'s sibling on the same axis, answering the question score
 * cannot: <em>"이 컨텍스트, 지금 몇 % 성공하고 있나?"</em>. Plain JDBC, matching the persistence adapter's
 * idiom.
 *
 * <p><b>Why the rate is not derivable from the score curve.</b> The engine adds a fixed recovery step on
 * success and subtracts a per-failure-kind penalty on failure, then clamps to {@code [-100, 100]}. Two of
 * those three properties destroy the ratio: the penalty differs by kind, and the clamp discards magnitude.
 * A score of 70 is not "70% success", and no arithmetic recovers the fraction. Hence a separate counted
 * table rather than a second view over {@code score_rollup_hourly}.
 *
 * <p><b>Kind is stored but summed away here.</b> The table's grain includes the resource kind so a future
 * PROXY/ACCOUNT/SESSION slice needs no backfill; the context axis this reader serves does not use it, so
 * the query folds it with {@code GROUP BY context, bucket_hour}. Rows come back ordered by
 * {@code (context, bucket_hour)} so one pass groups them into an ascending-time series per context, the
 * shape the chart renders directly — the same single-pass grouping {@link ContextRollupReader} uses.
 *
 * <p>Every query is scoped by the server-decided {@code tenant_id} (the JWT's tenant, never a request
 * parameter).
 */
public final class ContextOutcomeReader {

    private static final String SELECT_HISTORY = "SELECT context, bucket_hour, SUM(success_count) AS success_count,"
            + " SUM(blocked_count) AS blocked_count, SUM(timeout_count) AS timeout_count,"
            + " SUM(slow_count) AS slow_count, SUM(connection_reset_count) AS connection_reset_count,"
            + " SUM(tls_handshake_count) AS tls_handshake_count"
            + " FROM report_outcome_hourly WHERE tenant_id = ? AND bucket_hour >= ?"
            + " GROUP BY context, bucket_hour ORDER BY context, bucket_hour";

    private static final Map<FailureType, String> FAILURE_COLUMNS = Map.of(
            FailureType.BLOCKED, "blocked_count",
            FailureType.TIMEOUT, "timeout_count",
            FailureType.SLOW, "slow_count",
            FailureType.CONNECTION_RESET, "connection_reset_count",
            FailureType.TLS_HANDSHAKE, "tls_handshake_count");

    private final DataSource dataSource;

    public ContextOutcomeReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * Every context's hourly outcome series since {@code since}, oldest point first within each context,
     * each accompanied by the window totals the dashboard's success-rate column reads.
     *
     * @param tenantId the server-decided tenant (from the JWT)
     * @param since the inclusive lower bound on bucket time (the window start)
     */
    public ContextOutcomeHistory read(String tenantId, Instant since) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(since, "since must not be null");
        // The ORDER BY delivers rows already grouped and time-ordered; a LinkedHashMap preserves that
        // order and lets each row append to its context's series in one pass.
        Map<String, List<OutcomePoint>> byContext = new LinkedHashMap<>();
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
            throw new IllegalStateException("context outcome rollup query failed", e);
        }
        List<ContextOutcomeSeries> contexts = new ArrayList<>();
        byContext.forEach(
                (context, points) -> contexts.add(new ContextOutcomeSeries(context, totalOf(points), points)));
        return new ContextOutcomeHistory(contexts);
    }

    /** One grouped bucket row as a chart point. */
    private static OutcomePoint pointOf(ResultSet rows) throws SQLException {
        Map<String, Long> failures = new LinkedHashMap<>();
        long failureTotal = 0;
        // Iterating the enum (not the map) keeps the breakdown's key order stable across rows and
        // responses, so the client's stacked bar never reorders between polls.
        for (FailureType type : FailureType.values()) {
            long count = rows.getLong(FAILURE_COLUMNS.get(type));
            failures.put(type.name(), count);
            failureTotal += count;
        }
        long success = rows.getLong("success_count");
        return new OutcomePoint(
                rows.getTimestamp("bucket_hour").toInstant(),
                success,
                failureTotal,
                rateOf(success, failureTotal),
                failures);
    }

    /**
     * Folds one context's points into the window totals behind its success-rate column. Summed from the
     * points already in hand rather than by a second {@code GROUP BY context} query — one round trip, and
     * the column can never disagree with the curve drawn beside it.
     */
    private static OutcomeTotals totalOf(List<OutcomePoint> points) {
        long success = 0;
        long failure = 0;
        Map<String, Long> failures = new LinkedHashMap<>();
        for (FailureType type : FailureType.values()) {
            failures.put(type.name(), 0L); // fixed key order, zeroes included
        }
        for (OutcomePoint point : points) {
            success += point.success();
            failure += point.failure();
            point.failures().forEach((type, count) -> failures.merge(type, count, Long::sum));
        }
        return new OutcomeTotals(success, failure, rateOf(success, failure), failures);
    }

    /**
     * Success over total, or {@code null} when the window holds no report at all. Null rather than
     * {@code 0.0} on purpose: "아직 보고가 없다" and "전부 실패했다" are opposite situations, and a rate of
     * zero would render the first as the second — the exact misreading this view exists to prevent.
     *
     * <p>Divided here rather than stored pre-divided for the same reason {@code score_rollup_hourly}
     * stores a sum and a count: a rate cannot be merged with a later observation without its weight.
     */
    private static Double rateOf(long success, long failure) {
        long total = success + failure;
        return total == 0 ? null : (double) success / total;
    }

    /** Every context's outcome curve over the requested window, one series per context. */
    public record ContextOutcomeHistory(List<ContextOutcomeSeries> contexts) {}

    /** One context's window totals plus its ascending-time hourly points. */
    public record ContextOutcomeSeries(String context, OutcomeTotals totals, List<OutcomePoint> points) {}

    /**
     * One context summed over the whole window: the success-rate column's numbers. {@code failures} always
     * carries all five {@link FailureType} keys (zeroes included) so the client can render a fixed-order
     * breakdown without reconciling missing keys. {@code successRate} is null when the window is empty.
     */
    public record OutcomeTotals(long success, long failure, Double successRate, Map<String, Long> failures) {}

    /** One hour of one context, summed across resource kinds. {@code successRate} is null for an empty hour. */
    public record OutcomePoint(
            Instant at, long success, long failure, Double successRate, Map<String, Long> failures) {}
}
