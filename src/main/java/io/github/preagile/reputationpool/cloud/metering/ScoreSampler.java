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
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(INSERT_SAMPLE)) {
            for (Map.Entry<CellKey, ReputationCell> entry : cells.entrySet()) {
                CellKey key = entry.getKey();
                statement.setString(1, managed.tenantId());
                statement.setString(2, key.resource().kind().name());
                statement.setString(3, key.resource().value());
                statement.setString(4, key.context().value());
                statement.setTimestamp(5, now);
                statement.setDouble(6, entry.getValue().score());
                statement.addBatch();
            }
            statement.executeBatch();
        } catch (SQLException e) {
            throw new IllegalStateException("score_sample batch insert failed", e);
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
        if (!score.purgeEnabled()) {
            return;
        }
        Duration retention = score.retention();
        Instant cutoff = clock.instant().minus(retention);
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(DELETE_OLDER_THAN)) {
            statement.setTimestamp(1, Timestamp.from(cutoff));
            int purged = statement.executeUpdate();
            if (purged > 0) {
                log.info("score retention purged {} samples older than {}", purged, retention);
            }
        } catch (SQLException e) {
            log.warn("score_sample purge failed; will retry on the next interval", e);
        }
    }
}
