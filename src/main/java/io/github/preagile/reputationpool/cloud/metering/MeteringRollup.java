package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry.ManagedPool;
import io.github.preagile.reputationpool.cloud.metering.MeterRecorder.Key;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Objects;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Periodically folds in-memory meters into the durable {@code usage_meter} table (issue #10), reusing
 * the {@link io.github.preagile.reputationpool.cloud.engine.PoolLifecycle} {@code @Scheduled} pattern
 * (property-tuned interval, per-tenant exception isolation).
 *
 * <ul>
 *   <li><b>Leases</b> are a counter: each flush drains the accumulated deltas from {@link MeterRecorder}
 *       and adds them to the day's row ({@code ON CONFLICT ... value = value + EXCLUDED.value}). A delta
 *       whose write fails is handed back to the recorder and retried next cycle, not lost.
 *   <li><b>Pool size</b> is a gauge: each flush samples the registered-resource count of every live pool
 *       and sets the day's row ({@code value = EXCLUDED.value}). Only already-built pools are sampled, so
 *       sampling never forces a dormant tenant's pool into existence.
 * </ul>
 */
public final class MeteringRollup {

    private static final Logger log = LoggerFactory.getLogger(MeteringRollup.class);

    private static final String UPSERT_LEASE =
            "INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)"
                    + " VALUES (?, 'lease', ?, ?, ?)"
                    + " ON CONFLICT (tenant_id, metric, period_start)"
                    + " DO UPDATE SET value = usage_meter.value + EXCLUDED.value, updated_at = EXCLUDED.updated_at";
    private static final String UPSERT_POOL_SIZE =
            "INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)"
                    + " VALUES (?, 'pool_size', ?, ?, ?)"
                    + " ON CONFLICT (tenant_id, metric, period_start)"
                    + " DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at";

    private final DataSource dataSource;
    private final Clock clock;
    private final MeterRecorder recorder;
    private final PerTenantPoolRegistry registry;

    public MeteringRollup(DataSource dataSource, Clock clock, MeterRecorder recorder, PerTenantPoolRegistry registry) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.recorder = Objects.requireNonNull(recorder, "recorder must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
    }

    @Scheduled(fixedDelayString = "${reputation-pool.metering.flush-interval:PT1M}")
    public void flush() {
        LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
        flushLeaseDeltas(today);
        samplePoolSizes(today);
    }

    private void flushLeaseDeltas(LocalDate today) {
        Timestamp now = Timestamp.from(clock.instant());
        for (Map.Entry<Key, Long> entry : recorder.drainLeaseDeltas(today).entrySet()) {
            Key key = entry.getKey();
            long delta = entry.getValue();
            try {
                upsert(UPSERT_LEASE, key.tenantId(), key.day(), delta, now);
            } catch (RuntimeException e) {
                // Keep the count rather than lose it — retried on the next flush.
                recorder.restore(key, delta);
                log.warn(
                        "metering: lease flush failed for tenant {} on {} — retrying next cycle",
                        key.tenantId(),
                        key.day(),
                        e);
            }
        }
    }

    private void samplePoolSizes(LocalDate today) {
        Timestamp now = Timestamp.from(clock.instant());
        for (ManagedPool managed : registry.managedPools()) {
            try {
                long size = managed.pool().snapshot().registered().size();
                upsert(UPSERT_POOL_SIZE, managed.tenantId(), today, size, now);
            } catch (RuntimeException e) {
                // One tenant's failure must not stop the others (PoolLifecycle isolation pattern).
                log.warn("metering: pool-size sample failed for tenant {}", managed.tenantId(), e);
            }
        }
    }

    private void upsert(String sql, String tenantId, LocalDate day, long value, Timestamp now) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, tenantId);
            statement.setObject(2, day);
            statement.setLong(3, value);
            statement.setTimestamp(4, now);
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("usage_meter upsert failed", e);
        }
    }
}
