package io.github.preagile.reputationpool.cloud.metering;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Counts;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Key;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The counting half of the per-context success rate (issue #189): what {@code report()} accumulates in
 * memory and what a flush cycle takes away from it. Docker-free, runs in the {@code build} gate.
 */
@DisplayName("OutcomeRecorder: report 결과를 (테넌트×컨텍스트×리소스종류×시간) 버킷에 메모리로 누적하고 플러시가 비워 가는 카운터")
class OutcomeRecorderTest {

    private static final Instant HOUR = Instant.parse("2026-08-12T10:00:00Z");
    private static final Instant NEXT_HOUR = HOUR.plus(1, ChronoUnit.HOURS);

    private final OutcomeRecorder recorder = new OutcomeRecorder();

    private static Key key(String context, ResourceKind kind, Instant hour) {
        return new Key("tenant-a", context, kind, hour);
    }

    @Test
    @DisplayName("성공 2건·BLOCKED 1건·TIMEOUT 1건을 같은 버킷에 기록하면 → 한 버킷이 성공 2, 실패 종류별 1/1 로 드레인된다")
    void countsSuccessesAndFailuresPerType() {
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        recorder.recordFailure("tenant-a", "scrape", ResourceKind.PROXY, HOUR, FailureType.BLOCKED);
        recorder.recordFailure("tenant-a", "scrape", ResourceKind.PROXY, HOUR, FailureType.TIMEOUT);

        Map<Key, Counts> drained = recorder.drain(HOUR);

        assertThat(drained).hasSize(1);
        Counts counts = drained.get(key("scrape", ResourceKind.PROXY, HOUR));
        assertThat(counts.success()).isEqualTo(2);
        assertThat(counts.failureCount(FailureType.BLOCKED)).isEqualTo(1);
        assertThat(counts.failureCount(FailureType.TIMEOUT)).isEqualTo(1);
        assertThat(counts.failureCount(FailureType.SLOW)).isZero();
        assertThat(counts.total()).isEqualTo(4);
    }

    @Test
    @DisplayName("컨텍스트·리소스종류·시간 중 하나라도 다르면 → 서로 다른 버킷으로 분리된다")
    void separatesBucketsByContextKindAndHour() {
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        recorder.recordSuccess("tenant-a", "checkout", ResourceKind.PROXY, HOUR);
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.ACCOUNT, HOUR);
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, NEXT_HOUR);
        recorder.recordSuccess("tenant-b", "scrape", ResourceKind.PROXY, HOUR);

        Map<Key, Counts> drained = recorder.drain(NEXT_HOUR);

        assertThat(drained).hasSize(5);
        assertThat(drained.values())
                .allSatisfy(counts -> assertThat(counts.total()).isEqualTo(1));
    }

    @Test
    @DisplayName("드레인한 뒤 다시 드레인하면 → 그 사이 새 보고가 없었으므로 아무 버킷도 나오지 않는다(같은 카운트를 두 번 쓰지 않는다)")
    void drainingResetsTheCounters() {
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        assertThat(recorder.drain(HOUR)).hasSize(1);

        assertThat(recorder.drain(HOUR)).isEmpty();
    }

    @Test
    @DisplayName("DB 쓰기에 실패해 되돌려 준 버킷은 → 다음 드레인에서 원래 카운트 그대로 다시 나온다")
    void restoredBucketsComeBackOnTheNextDrain() {
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        recorder.recordFailure("tenant-a", "scrape", ResourceKind.PROXY, HOUR, FailureType.SLOW);
        Key key = key("scrape", ResourceKind.PROXY, HOUR);
        Counts drained = recorder.drain(HOUR).get(key);

        recorder.restore(key, drained);

        Counts again = recorder.drain(HOUR).get(key);
        assertThat(again.success()).isEqualTo(1);
        assertThat(again.failureCount(FailureType.SLOW)).isEqualTo(1);
    }

    @Test
    @DisplayName("되돌려 준 버킷에 같은 시간대 보고가 더 쌓이면 → 다음 드레인은 되돌린 값과 새 값을 합쳐 내보낸다")
    void restoredCountsAccumulateWithNewReports() {
        Key key = key("scrape", ResourceKind.PROXY, HOUR);
        recorder.restore(key, new Counts(2, Map.of(FailureType.BLOCKED, 3L)));
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
        recorder.recordFailure("tenant-a", "scrape", ResourceKind.PROXY, HOUR, FailureType.BLOCKED);

        Counts counts = recorder.drain(HOUR).get(key);

        assertThat(counts.success()).isEqualTo(3);
        assertThat(counts.failureCount(FailureType.BLOCKED)).isEqualTo(4);
    }

    @Nested
    @DisplayName("WhenTheHourRolls")
    class WhenTheHourRolls {

        /**
         * The reclamation itself (dropping the past hour's map entry) is not observable through the public
         * API — a reclaimed bucket that receives another report simply reappears. What <em>is</em>
         * observable, and what actually matters, is the boundary condition around it: the past hour must
         * still hand over its counts on the way out (dropping it unflushed would silently lose the last
         * minute of every hour), and the current hour must keep accumulating afterwards.
         */
        @Test
        @DisplayName("시간이 넘어간 뒤 플러시하면 → 지난 시간 버킷도 카운트를 넘기고 나가고, 현재 시간 버킷은 계속 누적된다")
        void handsOverThePastHourAndKeepsAccumulatingTheCurrentOne() {
            recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
            recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, NEXT_HOUR);

            // 플러시 시점이 NEXT_HOUR 이므로 HOUR 버킷은 회수 대상, NEXT_HOUR 버킷은 유지 대상이다.
            Map<Key, Counts> first = recorder.drain(NEXT_HOUR);
            assertThat(first).hasSize(2);
            assertThat(first.get(key("scrape", ResourceKind.PROXY, HOUR)).success())
                    .isEqualTo(1);

            recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, NEXT_HOUR);
            Map<Key, Counts> second = recorder.drain(NEXT_HOUR);
            assertThat(second).hasSize(1);
            assertThat(second.get(key("scrape", ResourceKind.PROXY, NEXT_HOUR)).success())
                    .isEqualTo(1);
        }
    }

    @Nested
    @DisplayName("WhenReportedConcurrently")
    class WhenReportedConcurrently {

        private static final int THREADS = 16;
        private static final int PER_THREAD = 500;

        /**
         * {@link OutcomeRecorder} claims thread safety (a {@code ConcurrentHashMap} of {@code LongAdder}s)
         * because every gRPC worker reports into it at once. A single-threaded test would pass with the
         * adders swapped for plain {@code long}s, so it would never touch that claim.
         *
         * <p>Two-phase rendezvous: every thread signals it is at the line, the test releases them all with
         * one countdown, so the increments genuinely overlap instead of depending on scheduler luck. The
         * pool is sized at {@code THREADS} so the rendezvous cannot deadlock on a queued task.
         *
         * <p>The invariant is an <b>equality</b>, not a bound: exactly {@code THREADS × PER_THREAD}
         * successes and the same number of {@code BLOCKED} failures. An inequality would let a lost update
         * pass unnoticed, which is precisely the defect this exists to catch.
         */
        @Test
        @DisplayName("16개 스레드가 같은 버킷에 동시에 보고해도 → 성공·실패 카운트가 정확히 (스레드 수 × 건수) 로 집계된다")
        void concurrentReportsLoseNoCount() throws Exception {
            CountDownLatch ready = new CountDownLatch(THREADS);
            CountDownLatch start = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(THREADS);
            ExecutorService pool = Executors.newFixedThreadPool(THREADS);
            try {
                for (int t = 0; t < THREADS; t++) {
                    pool.execute(() -> {
                        ready.countDown();
                        try {
                            start.await();
                            for (int i = 0; i < PER_THREAD; i++) {
                                recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, HOUR);
                                recorder.recordFailure(
                                        "tenant-a", "scrape", ResourceKind.PROXY, HOUR, FailureType.BLOCKED);
                            }
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        } finally {
                            done.countDown();
                        }
                    });
                }
                assertThat(ready.await(10, TimeUnit.SECONDS))
                        .as("every thread reached the start line")
                        .isTrue();
                start.countDown();
                assertThat(done.await(30, TimeUnit.SECONDS))
                        .as("every thread finished reporting")
                        .isTrue();
            } finally {
                pool.shutdownNow();
            }

            Counts counts = recorder.drain(HOUR).get(key("scrape", ResourceKind.PROXY, HOUR));
            assertThat(counts.success()).isEqualTo((long) THREADS * PER_THREAD);
            assertThat(counts.failureCount(FailureType.BLOCKED)).isEqualTo((long) THREADS * PER_THREAD);
        }
    }
}
