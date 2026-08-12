package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * In-memory per-context outcome counters, accumulated on the gRPC {@code Report} path and drained
 * periodically by {@link OutcomeRollup} into the {@code report_outcome_hourly} table (issue #189).
 *
 * <p>This is {@link MeterRecorder}'s shape, one axis wider. Counting happens here (lock-free
 * {@link LongAdder}s per bucket) rather than a write-per-report, because {@code Report} is the hottest RPC
 * cloud serves — a synchronous DB round trip on it would put the persistence layer's latency directly in
 * every caller's report path. The trade-off is the same as metering's: counts not yet flushed are lost if
 * the process dies, bounded by the flush interval (default 1 minute). A success rate is a statistical
 * reading, so losing under a minute of counts moves the ratio by nothing that changes a decision.
 *
 * <p><b>The hour is part of the key, not decided at flush time.</b> A report at 10:59:59 flushed at
 * 11:00:05 belongs to the 10:00 bucket; deriving the bucket from the flush clock instead would smear it
 * into 11:00 and dent both hours' rates. {@link #drain(Instant)} therefore keeps the current hour so a
 * concurrent increment is never dropped — {@link MeterRecorder#drainLeaseDeltas} 's day rule at hour
 * resolution — and reclaims older buckets only once a full hour has passed since they stopped receiving
 * increments, because the increment happens outside the map and a bucket removed mid-hand-off would lose
 * that report for good (see {@link #drain(Instant)}).
 *
 * <p>Thread safety: the map is a {@link ConcurrentHashMap} and every counter inside a {@link Tally} is a
 * {@link LongAdder} allocated once at construction, so concurrent reports on any number of gRPC threads
 * only ever contend inside the adders.
 */
public final class OutcomeRecorder {

    /** One (tenant, context, resource kind) bucket for one UTC hour. */
    public record Key(String tenantId, String context, ResourceKind kind, Instant bucketHour) {}

    /**
     * One drained bucket: successes plus the per-{@link FailureType} failure counts. {@code failures} only
     * carries the types that actually occurred, so an all-success bucket drains an empty map rather than
     * five zeroes.
     */
    public record Counts(long success, Map<FailureType, Long> failures) {

        public Counts {
            failures = Map.copyOf(failures);
        }

        /** Total reports in the bucket — the denominator of the success rate. */
        public long total() {
            long total = success;
            for (long count : failures.values()) {
                total += count;
            }
            return total;
        }

        /** The count for {@code type}, or zero when that failure never occurred in this bucket. */
        public long failureCount(FailureType type) {
            return failures.getOrDefault(type, 0L);
        }
    }

    private final ConcurrentHashMap<Key, Tally> tallies = new ConcurrentHashMap<>();

    /** Records one successful report. Non-blocking. */
    public void recordSuccess(String tenantId, String context, ResourceKind kind, Instant bucketHour) {
        tallyFor(tenantId, context, kind, bucketHour).success.increment();
    }

    /** Records one failed report, attributed to {@code type}. Non-blocking. */
    public void recordFailure(
            String tenantId, String context, ResourceKind kind, Instant bucketHour, FailureType type) {
        Objects.requireNonNull(type, "type must not be null");
        tallyFor(tenantId, context, kind, bucketHour).failures[type.ordinal()].increment();
    }

    private Tally tallyFor(String tenantId, String context, ResourceKind kind, Instant bucketHour) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(context, "context must not be null");
        Objects.requireNonNull(kind, "kind must not be null");
        Objects.requireNonNull(bucketHour, "bucketHour must not be null");
        return tallies.computeIfAbsent(new Key(tenantId, context, kind, bucketHour), key -> new Tally());
    }

    /**
     * Removes and returns the accumulated counts per bucket, resetting each counter to zero. The rollup
     * adds these to {@code report_outcome_hourly}; a bucket whose DB write fails is handed back via
     * {@link #restore} so it is retried next cycle rather than lost.
     *
     * @param currentHour the hour bucket that is still receiving increments; buckets older than the
     *     <em>previous</em> hour are reclaimed after being drained, so an idle process does not leak an
     *     entry per elapsed hour
     */
    public Map<Key, Counts> drain(Instant currentHour) {
        Objects.requireNonNull(currentHour, "currentHour must not be null");
        // 회수 기준을 한 시간 늦춘다. 증가는 맵 밖에서 일어나므로(computeIfAbsent 가 Tally 를 돌려준 뒤
        // LongAdder 를 올린다) 그 사이에 그 엔트리를 제거하면 재개된 보고는 맵에서 분리된 어댑터를
        // 올리게 되고, 그 한 건은 어느 drain 에도 실리지 않는다 — 원본 보고는 어디에도 저장되지 않으므로
        // 영구 유실이다. 정각 직후 플러시는 흔하므로(경계 ±수십 ms) 이 창은 실제로 열린다. 한 시간을
        // 유예하면 같은 사고가 나려면 한 스레드가 인접한 두 문장 사이에서 한 시간 넘게 멈춰 있어야 한다.
        // 비용은 버킷당 엔트리 하나를 한 시간 더 들고 있는 것뿐이다(입도상 테넌트당 시간 60행 규모).
        Instant reclaimBefore = currentHour.minus(1, ChronoUnit.HOURS);
        Map<Key, Counts> drained = new HashMap<>();
        var it = tallies.entrySet().iterator();
        while (it.hasNext()) {
            var entry = it.next();
            Counts counts = entry.getValue().drain();
            if (counts.total() != 0) {
                drained.put(entry.getKey(), counts);
            }
            if (entry.getKey().bucketHour().isBefore(reclaimBefore)) {
                it.remove(); // 두 시간 넘게 지난 버킷: 더 들어올 증분이 없으므로 소진 후 회수
            }
        }
        return drained;
    }

    /** Adds a drained bucket back after a failed flush, so the next drain retries it. */
    public void restore(Key key, Counts counts) {
        Objects.requireNonNull(key, "key must not be null");
        Objects.requireNonNull(counts, "counts must not be null");
        Tally tally = tallies.computeIfAbsent(key, k -> new Tally());
        tally.success.add(counts.success());
        counts.failures().forEach((type, count) -> tally.failures[type.ordinal()].add(count));
    }

    /**
     * One bucket's counters. The adder array is indexed by {@link FailureType#ordinal()} and fully
     * populated at construction, so no entry is ever created or replaced afterwards — that is what makes
     * concurrent {@code recordFailure} calls safe without a lock or a concurrent map per bucket.
     */
    private static final class Tally {

        private final LongAdder success = new LongAdder();
        private final LongAdder[] failures = new LongAdder[FailureType.values().length];

        Tally() {
            for (int i = 0; i < failures.length; i++) {
                failures[i] = new LongAdder();
            }
        }

        /**
         * Empties every counter into an immutable snapshot. Not atomic across the counters — a report
         * landing mid-drain is simply counted in the next cycle, which is the same tolerance
         * {@link MeterRecorder} accepts (the bucket is additive, so nothing is lost or double-counted).
         */
        Counts drain() {
            Map<FailureType, Long> byType = new EnumMap<>(FailureType.class);
            for (FailureType type : FailureType.values()) {
                long count = failures[type.ordinal()].sumThenReset();
                if (count != 0) {
                    byType.put(type, count);
                }
            }
            return new Counts(success.sumThenReset(), byType);
        }
    }
}
