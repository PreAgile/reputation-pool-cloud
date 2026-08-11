package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry.ManagedPool;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Periodically samples every live pool's per-cell reputation score into the durable {@code score_sample}
 * table (issue #12) — the raw points behind the dashboard's 24h reputation curve. It reuses the
 * {@link MeteringRollup} {@code @Scheduled} pattern exactly: a property-tuned interval, only
 * already-built pools sampled (so a dormant tenant is never forced into existence), and per-tenant
 * exception isolation so one tenant's DB error never stops the others.
 *
 * <p><b>Cardinality.</b> One row is written per {@code (tenant × resource × context)} cell per tick, so
 * this is the highest-volume writer in cloud. Two things keep it bounded: each tenant's whole flush is a
 * single JDBC batch (one round trip, not one statement per cell), and {@link #purgeExpired()} trims
 * samples past the configured retention on its own schedule — the same age-based purge the audit trail
 * uses.
 *
 * <p>The insert is idempotent on the sample key ({@code ON CONFLICT ... DO UPDATE}): a replayed flush at
 * the same instant overwrites rather than fails, which is what lets a test drive {@link #flush()}
 * directly under a fixed clock.
 */
public final class ScoreSampler {

    private static final Logger log = LoggerFactory.getLogger(ScoreSampler.class);

    private static final String INSERT_SAMPLE =
            "INSERT INTO score_sample (tenant_id, resource_kind, resource_value, context, sampled_at, score)"
                    + " VALUES (?, ?, ?, ?, ?, ?)"
                    + " ON CONFLICT (tenant_id, resource_kind, resource_value, context, sampled_at)"
                    + " DO UPDATE SET score = EXCLUDED.score";
    private static final String DELETE_OLDER_THAN = "DELETE FROM score_sample WHERE sampled_at < ?";
    private static final String DELETE_ROLLUP_OLDER_THAN = "DELETE FROM score_rollup_hourly WHERE bucket_hour < ?";

    /**
     * Folds one tick's per-context aggregate into that hour's bucket. Sums accumulate (so the reader can
     * divide for a weighted average), min/max widen, and {@code cells} is a gauge overwritten with this
     * tick's count — the same counter-vs-gauge split {@code MeteringRollup} uses.
     */
    private static final String UPSERT_ROLLUP =
            "INSERT INTO score_rollup_hourly (tenant_id, context, bucket_hour, score_sum, sample_count,"
                    + " min_score, max_score, cells) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                    + " ON CONFLICT (tenant_id, context, bucket_hour) DO UPDATE SET"
                    + " score_sum = score_rollup_hourly.score_sum + EXCLUDED.score_sum,"
                    + " sample_count = score_rollup_hourly.sample_count + EXCLUDED.sample_count,"
                    + " min_score = LEAST(score_rollup_hourly.min_score, EXCLUDED.min_score),"
                    + " max_score = GREATEST(score_rollup_hourly.max_score, EXCLUDED.max_score),"
                    + " cells = EXCLUDED.cells";

    private final DataSource dataSource;
    private final Clock clock;
    private final PerTenantPoolRegistry registry;
    private final ReputationPoolProperties properties;

    public ScoreSampler(
            DataSource dataSource, Clock clock, PerTenantPoolRegistry registry, ReputationPoolProperties properties) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    /** Snapshots each live pool's cell scores and batch-inserts them, one batch (and try/catch) per tenant. */
    @Scheduled(fixedDelayString = "${reputation-pool.score.sample-interval:PT1M}")
    public void flush() {
        Timestamp now = Timestamp.from(clock.instant());
        for (ManagedPool managed : registry.managedPools()) {
            try {
                sampleOne(managed, now);
            } catch (RuntimeException e) {
                // One tenant's failure must not stop the others (PoolLifecycle/rollup isolation pattern).
                log.warn("score sampling failed for tenant {}", managed.tenantId(), e);
            }
        }
    }

    private void sampleOne(ManagedPool managed, Timestamp now) {
        Map<CellKey, ReputationCell> cells = managed.pool().snapshot().cells();
        if (cells.isEmpty()) {
            return; // nothing to sample; skip the connection entirely
        }
        // One pass builds both writes: the raw per-cell rows and this tick's per-context aggregate. The
        // aggregate is computed here rather than by re-reading score_sample because the rows are already
        // in hand — the rollup never has to scan the big table.
        //
        // Both writes are one transaction. The rollup accumulates (score_sum += …), so a tick that lands
        // its raw rows but loses its rollup is not self-healing: the next tick carries a different
        // sampled_at and never replays the missing observation, leaving the bucket permanently short. The
        // raw insert alone is idempotent on its key, so replaying the whole tick after a rollback is safe.
        Map<String, ContextAggregate> perContext = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection()) {
            boolean autoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement(INSERT_SAMPLE)) {
                for (Map.Entry<CellKey, ReputationCell> entry : cells.entrySet()) {
                    CellKey key = entry.getKey();
                    double score = entry.getValue().score();
                    statement.setString(1, managed.tenantId());
                    statement.setString(2, key.resource().kind().name());
                    statement.setString(3, key.resource().value());
                    statement.setString(4, key.context().value());
                    statement.setTimestamp(5, now);
                    statement.setDouble(6, score);
                    statement.addBatch();
                    perContext
                            .computeIfAbsent(key.context().value(), context -> new ContextAggregate())
                            .add(score);
                }
                statement.executeBatch();
                rollUp(connection, managed.tenantId(), now, perContext);
                connection.commit();
            } catch (SQLException | RuntimeException e) {
                rollback(connection);
                throw e;
            } finally {
                restoreAutoCommit(connection, autoCommit);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("score_sample batch insert failed", e);
        }
    }

    /** Best-effort rollback: the original failure is what the caller must see, so this never throws. */
    private static void rollback(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException e) {
            log.warn("score sample rollback failed", e);
        }
    }

    /** Puts the pooled connection back the way it was found before it returns to the pool. */
    private static void restoreAutoCommit(Connection connection, boolean autoCommit) {
        try {
            connection.setAutoCommit(autoCommit);
        } catch (SQLException e) {
            log.warn("restoring auto-commit failed", e);
        }
    }

    /** Folds this tick's per-context aggregate into the hourly buckets, one batch on the same connection. */
    private void rollUp(Connection connection, String tenantId, Timestamp now, Map<String, ContextAggregate> perContext)
            throws SQLException {
        Timestamp bucket = Timestamp.from(now.toInstant().truncatedTo(ChronoUnit.HOURS));
        try (PreparedStatement statement = connection.prepareStatement(UPSERT_ROLLUP)) {
            for (Map.Entry<String, ContextAggregate> entry : perContext.entrySet()) {
                ContextAggregate aggregate = entry.getValue();
                statement.setString(1, tenantId);
                statement.setString(2, entry.getKey());
                statement.setTimestamp(3, bucket);
                statement.setDouble(4, aggregate.sum);
                statement.setLong(5, aggregate.count);
                statement.setDouble(6, aggregate.min);
                statement.setDouble(7, aggregate.max);
                statement.setInt(8, aggregate.count);
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    /** One context's scores within a single tick, reduced to what the hourly bucket needs. */
    private static final class ContextAggregate {

        private double sum;
        private int count;
        private double min = Double.POSITIVE_INFINITY;
        private double max = Double.NEGATIVE_INFINITY;

        void add(double score) {
            sum += score;
            count++;
            min = Math.min(min, score);
            max = Math.max(max, score);
        }
    }

    /**
     * Drops samples older than the configured retention. Off when retention is {@code <= 0} (keep
     * everything); exception-isolated so a transient DB error is retried on the next interval rather than
     * cancelling the schedule — the audit-purge pattern.
     */
    @Scheduled(
            initialDelayString = "${reputation-pool.score.purge-interval:PT1H}",
            fixedDelayString = "${reputation-pool.score.purge-interval:PT1H}")
    public void purgeExpired() {
        ReputationPoolProperties.Score score = properties.score();
        if (score.purgeEnabled()) {
            purge(DELETE_OLDER_THAN, score.retention(), "score_sample");
        }
        // The rollup is purged on its own (much longer) retention — it is the only thing left once the raw
        // samples age out, so trimming it on the raw window would silently cap the context view at 7 days.
        if (score.rollupPurgeEnabled()) {
            purge(DELETE_ROLLUP_OLDER_THAN, score.rollupRetention(), "score_rollup_hourly");
        }
    }

    private void purge(String sql, Duration retention, String table) {
        Instant cutoff = clock.instant().minus(retention);
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setTimestamp(1, Timestamp.from(cutoff));
            int purged = statement.executeUpdate();
            if (purged > 0) {
                log.info("score retention purged {} {} rows older than {}", purged, table, retention);
            }
        } catch (SQLException e) {
            log.warn("{} purge failed; will retry on the next interval", table, e);
        }
    }
}
