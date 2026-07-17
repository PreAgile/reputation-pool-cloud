package io.github.preagile.reputationpool.cloud.readmodel;

import io.github.preagile.reputationpool.core.domain.ResourceId;
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
 * Reads one resource's reputation-score time series for the dashboard's 24h curve (issue #12), from the
 * cloud-owned {@code score_sample} table. Plain JDBC, matching the persistence adapter's idiom (like
 * {@link AuditEventReader} and {@link UsageMeterReader}).
 *
 * <p>The query is scoped by the server-decided {@code tenant_id} (the JWT's tenant, never a request
 * parameter) and one {@code (kind, value)} resource, ranging over {@code sampled_at >= since}. Rows come
 * back ordered by {@code (context, sampled_at)} so a single pass groups them into one ascending-time
 * series per context — the shape the curve renders directly, one line per context.
 */
public final class ScoreHistoryReader {

    private static final String SELECT_HISTORY = "SELECT context, sampled_at, score FROM score_sample"
            + " WHERE tenant_id = ? AND resource_kind = ? AND resource_value = ? AND sampled_at >= ?"
            + " ORDER BY context, sampled_at";

    private final DataSource dataSource;

    public ScoreHistoryReader(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
    }

    /**
     * The resource's per-context score series since {@code since}, oldest point first within each context.
     *
     * @param tenantId the server-decided tenant (from the JWT)
     * @param resource the resource whose cells were sampled ({@code kind} matched by its enum name)
     * @param since the inclusive lower bound on sample time (the curve's window start)
     */
    public ScoreHistory read(String tenantId, ResourceId resource, Instant since) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(resource, "resource must not be null");
        Objects.requireNonNull(since, "since must not be null");
        // Rows arrive grouped and time-ordered by the ORDER BY; a LinkedHashMap preserves that context
        // order and lets each new row append to its context's series in one pass.
        Map<String, List<ScorePoint>> byContext = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_HISTORY)) {
            statement.setString(1, tenantId);
            statement.setString(2, resource.kind().name());
            statement.setString(3, resource.value());
            statement.setTimestamp(4, Timestamp.from(since));
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    byContext
                            .computeIfAbsent(rows.getString("context"), key -> new ArrayList<>())
                            .add(new ScorePoint(rows.getTimestamp("sampled_at").toInstant(), rows.getDouble("score")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("score history query failed", e);
        }
        List<ContextSeries> contexts = new ArrayList<>();
        byContext.forEach((context, points) -> contexts.add(new ContextSeries(context, points)));
        return new ScoreHistory(contexts);
    }

    /** One resource's score curve, one series per context. */
    public record ScoreHistory(List<ContextSeries> contexts) {}

    /** One context's ascending-time score points. */
    public record ContextSeries(String context, List<ScorePoint> points) {}

    /** A single sampled point: when it was taken and the score then. */
    public record ScorePoint(Instant at, double score) {}
}
