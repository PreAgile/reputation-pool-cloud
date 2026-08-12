package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Counts;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Key;
import io.github.preagile.reputationpool.core.domain.FailureType;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Periodically folds the in-memory {@link OutcomeRecorder} into the durable {@code report_outcome_hourly}
 * table (issue #189), reusing {@link MeteringRollup}'s {@code @Scheduled} shape exactly: a property-tuned
 * interval, per-bucket exception isolation, and a delta whose write fails handed back to the recorder for
 * the next cycle instead of being lost.
 *
 * <p>Every column is a counter, so the upsert is additive ({@code count = count + EXCLUDED.count}) and a
 * replayed flush can only ever over-count what a crash already lost — never corrupt an existing bucket.
 * That is also why the whole flush shares one connection and one prepared statement but <em>not</em> one
 * transaction: each bucket's upsert stands alone, so a single failing row is retried on its own rather
 * than dragging the other buckets' counts back into memory with it.
 *
 * <p>Retention is its own schedule and its own (much longer) window than the audit trail's. This table's
 * grain is (tenant × context × kind × hour), so a tenant running 20 contexts across all three resource
 * kinds costs at most 60 rows an hour — about 0.5M rows a year, an order of magnitude below what the raw
 * {@code score_sample} accumulates in its 7-day window. Keeping a full year is what makes "작년 이맘때보다
 * 나빠졌나" answerable at all, and it is the only place that question can be answered: the raw reports are
 * never stored anywhere.
 */
public final class OutcomeRollup {

    private static final Logger log = LoggerFactory.getLogger(OutcomeRollup.class);

    private static final String UPSERT =
            "INSERT INTO report_outcome_hourly (tenant_id, context, resource_kind, bucket_hour,"
                    + " success_count, blocked_count, timeout_count, slow_count, connection_reset_count,"
                    + " tls_handshake_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    + " ON CONFLICT (tenant_id, context, resource_kind, bucket_hour) DO UPDATE SET"
                    + " success_count = report_outcome_hourly.success_count + EXCLUDED.success_count,"
                    + " blocked_count = report_outcome_hourly.blocked_count + EXCLUDED.blocked_count,"
                    + " timeout_count = report_outcome_hourly.timeout_count + EXCLUDED.timeout_count,"
                    + " slow_count = report_outcome_hourly.slow_count + EXCLUDED.slow_count,"
                    + " connection_reset_count = report_outcome_hourly.connection_reset_count"
                    + " + EXCLUDED.connection_reset_count,"
                    + " tls_handshake_count = report_outcome_hourly.tls_handshake_count"
                    + " + EXCLUDED.tls_handshake_count";
    private static final String DELETE_OLDER_THAN = "DELETE FROM report_outcome_hourly WHERE bucket_hour < ?";

    private final DataSource dataSource;
    private final Clock clock;
    private final OutcomeRecorder recorder;
    private final ReputationPoolProperties properties;

    public OutcomeRollup(
            DataSource dataSource, Clock clock, OutcomeRecorder recorder, ReputationPoolProperties properties) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.recorder = Objects.requireNonNull(recorder, "recorder must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    /**
     * Drains every accumulated bucket and folds it into its hour's row.
     *
     * <p>{@code pending} is what has not reached the database yet. A bucket is removed from it the moment
     * its own upsert is decided — written, or failed and already handed back — so the {@code finally} can
     * restore the rest without any chance of restoring a bucket that was in fact written. That matters
     * because the columns are counters: a spuriously restored bucket would be added a second time on the
     * next cycle and inflate the rate, which is exactly the failure the isolation is meant to avoid.
     */
    @Scheduled(fixedDelayString = "${reputation-pool.outcome.flush-interval:PT1M}")
    public void flush() {
        Map<Key, Counts> drained = recorder.drain(clock.instant().truncatedTo(ChronoUnit.HOURS));
        if (drained.isEmpty()) {
            return; // nothing reported since the last cycle; skip the connection entirely
        }
        Map<Key, Counts> pending = new HashMap<>(drained);
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(UPSERT)) {
            for (Map.Entry<Key, Counts> entry : drained.entrySet()) {
                Key key = entry.getKey();
                Counts counts = entry.getValue();
                try {
                    writeOne(statement, key, counts);
                    pending.remove(key);
                } catch (RuntimeException e) {
                    // One bucket's failure must not cost the others their counts (MeteringRollup's
                    // per-delta isolation): hand this one back and keep flushing.
                    pending.remove(key);
                    recorder.restore(key, counts);
                    log.warn(
                            "outcome rollup: bucket tenant={} context={} kind={} hour={} failed — retrying next cycle",
                            key.tenantId(),
                            key.context(),
                            key.kind(),
                            key.bucketHour(),
                            e);
                }
            }
        } catch (SQLException | RuntimeException e) {
            log.warn("outcome rollup flush failed — {} buckets retried next cycle", pending.size(), e);
        } finally {
            pending.forEach(recorder::restore);
        }
    }

    /** One bucket's upsert. Every SQL failure is wrapped so the caller only has to catch one type. */
    private static void writeOne(PreparedStatement statement, Key key, Counts counts) {
        try {
            statement.setString(1, key.tenantId());
            statement.setString(2, key.context());
            statement.setString(3, key.kind().name());
            statement.setTimestamp(4, Timestamp.from(key.bucketHour()));
            statement.setLong(5, counts.success());
            statement.setLong(6, counts.failureCount(FailureType.BLOCKED));
            statement.setLong(7, counts.failureCount(FailureType.TIMEOUT));
            statement.setLong(8, counts.failureCount(FailureType.SLOW));
            statement.setLong(9, counts.failureCount(FailureType.CONNECTION_RESET));
            statement.setLong(10, counts.failureCount(FailureType.TLS_HANDSHAKE));
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("report_outcome_hourly upsert failed", e);
        }
    }

    /**
     * Drops rollup rows older than the configured retention. Off when retention is {@code <= 0} (keep
     * everything); exception-isolated so a transient DB error is retried on the next interval rather than
     * cancelling the schedule — the {@link ScoreSampler#purgeExpired()} pattern.
     */
    @Scheduled(
            initialDelayString = "${reputation-pool.outcome.purge-interval:PT1H}",
            fixedDelayString = "${reputation-pool.outcome.purge-interval:PT1H}")
    public void purgeExpired() {
        ReputationPoolProperties.Outcome outcome = properties.outcome();
        if (!outcome.purgeEnabled()) {
            return;
        }
        Duration retention = outcome.retention();
        Instant cutoff = clock.instant().minus(retention);
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(DELETE_OLDER_THAN)) {
            statement.setTimestamp(1, Timestamp.from(cutoff));
            int purged = statement.executeUpdate();
            if (purged > 0) {
                log.info("outcome retention purged {} report_outcome_hourly rows older than {}", purged, retention);
            }
        } catch (SQLException e) {
            log.warn("report_outcome_hourly purge failed; will retry on the next interval", e);
        }
    }
}
