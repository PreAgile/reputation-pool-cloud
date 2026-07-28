package io.github.preagile.reputationpool.cloud.engine;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

/**
 * How stale the durable copy of the pools is (issue #80): the time since the last checkpoint round in
 * which <em>every</em> tenant saved successfully.
 *
 * <p><b>Why this needs to exist.</b> A failing checkpoint is a fault with no symptom. Requests keep being
 * served correctly from the in-memory pools, so no latency, error-rate, or domain metric moves — the only
 * trace is a {@code log.warn} in {@link PoolLifecycle#checkpoint()}. The damage appears only at the next
 * restart, when the pools are rehydrated from a snapshot that is however many minutes old the failure
 * lasted. Elsewhere in this application the same class of failure is absorbed rather than observed:
 * {@code MeteringRollup} hands a failed usage delta back to its recorder and retries it next cycle. A
 * checkpoint cannot do that — each snapshot wholly replaces the last, so there is no queue to hand
 * anything back to (see {@code core.port.ResourceStore}: "The unit of persistence is the whole
 * PoolSnapshot"). Noticing is the only defence left, which is what this measures.
 *
 * <p><b>A round counts only if no tenant failed.</b> The checkpoint fans out per tenant and each tenant
 * can fail on its own. Treating "three of four saved" as success would hide the fourth forever, so
 * {@link #recordRound(int)} advances the timestamp only when the failure count is zero. The published age
 * therefore answers "how long since every tenant's state was durable?", which is the question that
 * matters before a restart. Keeping it a single number also keeps the tenant label off the series, the
 * same posture {@code MetricsEventSink} takes while per-tenant labelling waits on issue #81 — which
 * tenant failed is a log and failure-counter question, not an alerting one.
 *
 * <p><b>Cold start reads as zero, not as a fault.</b> The timestamp starts at construction time, so a
 * freshly booted process reports an age near zero that then grows until the first successful round. That
 * avoids both bad alternatives: reporting {@code 0} forever would make "never checkpointed" look
 * identical to "just checkpointed", and seeding a large value would fire the alert on every boot. It is
 * also literally true — nothing has been persisted since this process started — so a process whose
 * checkpoints never succeed crosses the threshold and alerts on its own.
 *
 * <p><b>Never throws.</b> Instrumentation must not be able to break what it observes. The recording calls
 * happen inside the checkpoint and restore paths, so any exception here could abort a chore that was
 * otherwise fine. Every operation is a single reference swap or counter increment; the guarantee is
 * stated and pinned by test rather than left implicit.
 *
 * <p>Written by the {@code @Scheduled} thread and read by whichever thread serves the scrape, so the
 * timestamp is held in an {@link AtomicReference} — the same safe-publication device core's
 * {@code ResourcePool} uses for its blocklist. No lock is needed for a single reference swap.
 */
public final class CheckpointFreshness {

    static final String AGE = "reputation.pool.checkpoint.age.seconds";
    static final String INTERVAL = "reputation.pool.checkpoint.interval.seconds";
    static final String CHECKPOINT_FAILURES = "reputation.pool.checkpoint.failures";
    static final String RESTORE_FAILURES = "reputation.pool.restore.failures";

    private final Clock clock;
    private final AtomicReference<Instant> lastFullSuccess;
    private final Counter checkpointFailures;
    private final Counter restoreFailures;

    /**
     * @param clock the injected clock, so age is deterministic in tests
     * @param registry where the gauges and counters are published
     * @param checkpointInterval the configured checkpoint period, published as a gauge so
     *     {@code monitoring/alerts.yml} can derive its threshold from it instead of hard-coding a second
     *     copy of the same number
     */
    public CheckpointFreshness(Clock clock, MeterRegistry registry, Duration checkpointInterval) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        Objects.requireNonNull(registry, "registry must not be null");
        Objects.requireNonNull(checkpointInterval, "checkpointInterval must not be null");
        // Boot time, not the epoch: see the cold-start note above.
        this.lastFullSuccess = new AtomicReference<>(clock.instant());

        Gauge.builder(AGE, this, CheckpointFreshness::ageSeconds)
                .description("Seconds since the last checkpoint round in which every tenant saved successfully")
                .strongReference(true)
                .register(registry);
        // The alert threshold is a multiple of this, so the rule and the configuration cannot drift apart.
        Gauge.builder(INTERVAL, checkpointInterval, Duration::toSeconds)
                .description("Configured seconds between checkpoint rounds")
                .strongReference(true)
                .register(registry);
        // Counters are pre-registered so they read 0 from the first scrape rather than blinking into
        // existence on the first failure — the convention MetricsEventSink states for its own counters.
        this.checkpointFailures = Counter.builder(CHECKPOINT_FAILURES)
                .description("Per-tenant checkpoint saves that failed")
                .register(registry);
        this.restoreFailures = Counter.builder(RESTORE_FAILURES)
                .description("Per-tenant restores that failed at startup")
                .register(registry);
    }

    /**
     * Records the outcome of one whole checkpoint round.
     *
     * @param failedTenants how many tenants failed to save in this round; the freshness timestamp
     *     advances only when this is zero
     */
    public void recordRound(int failedTenants) {
        if (failedTenants > 0) {
            checkpointFailures.increment(failedTenants);
            return;
        }
        lastFullSuccess.set(clock.instant());
    }

    /**
     * Records that one tenant could not be restored at startup.
     *
     * <p>This is deliberately only counted, not acted on. A failed restore leaves that tenant's pool empty
     * while it stays in the checkpoint set, so the next round writes that empty snapshot over the good one
     * — a loss the freshness gauge cannot show, because those saves <em>succeed</em>. Changing that
     * behaviour (skipping the save, or refusing to serve the tenant) trades availability for safety and is
     * tracked separately; surfacing it is what belongs in this slice.
     */
    public void recordRestoreFailure() {
        restoreFailures.increment();
    }

    /** Seconds since the last fully successful round; never negative, even if the clock steps backwards. */
    double ageSeconds() {
        long seconds = Duration.between(lastFullSuccess.get(), clock.instant()).toSeconds();
        return Math.max(0, seconds);
    }
}
