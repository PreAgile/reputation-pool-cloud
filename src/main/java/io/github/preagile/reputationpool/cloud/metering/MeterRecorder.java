package io.github.preagile.reputationpool.cloud.metering;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * In-memory per-tenant lease counters, accumulated on the pool's event thread and drained periodically
 * by {@link MeteringRollup} into the {@code usage_meter} table (issue #10).
 *
 * <p>Counting happens here (a lock-free {@link LongAdder} per tenant+day) rather than a write-per-lease,
 * so recording a lease on the hot path is non-blocking — the {@code EventSink} contract's requirement.
 * The trade-off is durability: counts not yet flushed are lost if the process dies (bounded by the
 * flush interval, default 1 minute). That is acceptable for v1 metering; the flush is frequent and the
 * data is billing-grade approximate, not transactional.
 */
public final class MeterRecorder {

    /** A tenant's counter bucket for one UTC day. */
    public record Key(String tenantId, LocalDate day) {}

    private final ConcurrentHashMap<Key, LongAdder> leaseCounts = new ConcurrentHashMap<>();

    /** Records one granted lease for {@code tenantId} on {@code day}. Non-blocking. */
    public void recordLease(String tenantId, LocalDate day) {
        leaseCounts
                .computeIfAbsent(new Key(tenantId, day), key -> new LongAdder())
                .increment();
    }

    /**
     * Removes and returns the accumulated lease deltas per tenant+day, resetting each counter to zero.
     * The rollup adds these to {@code usage_meter}; a delta whose DB write fails is handed back via
     * {@link #restore} so it is retried next cycle rather than lost.
     *
     * <p>Buckets for days before {@code today} are reclaimed after being drained: a past day receives no
     * further increments, so keeping its zeroed counter would only leak an entry per (tenant × elapsed day)
     * for the lifetime of the process. Today's bucket is kept so a concurrent increment is not dropped.
     */
    public Map<Key, Long> drainLeaseDeltas(LocalDate today) {
        Map<Key, Long> deltas = new HashMap<>();
        var it = leaseCounts.entrySet().iterator();
        while (it.hasNext()) {
            var entry = it.next();
            long delta = entry.getValue().sumThenReset();
            if (delta != 0) {
                deltas.put(entry.getKey(), delta);
            }
            if (entry.getKey().day().isBefore(today)) {
                it.remove(); // 지난 날짜: 이후 증분이 없으므로 소진 후 회수
            }
        }
        return deltas;
    }

    /** Adds a drained delta back after a failed flush, so the next drain retries it. */
    public void restore(Key key, long delta) {
        Objects.requireNonNull(key, "key must not be null");
        leaseCounts.computeIfAbsent(key, k -> new LongAdder()).add(delta);
    }
}
