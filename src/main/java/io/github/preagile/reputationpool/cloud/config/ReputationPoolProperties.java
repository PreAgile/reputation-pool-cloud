package io.github.preagile.reputationpool.cloud.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Engine wiring configuration bound from {@code reputation-pool.*}. These are the knobs the public
 * {@code AdvisorServer} composition root hard-codes as constants; here they are properties so an
 * operator can override them, with defaults that match the reference.
 *
 * @param leaseTtl how long an acquired lease is valid before it expires
 * @param checkpointInterval how often the background checkpointer saves the pool snapshot
 * @param engine reputation-engine tuning (window and cool/recover thresholds)
 * @param audit audit-trail retention configuration
 * @param metering usage-metering rollup configuration
 * @param score reputation-score time-series sampling configuration
 */
@ConfigurationProperties("reputation-pool")
public record ReputationPoolProperties(
        @DefaultValue("PT30S") Duration leaseTtl,
        @DefaultValue("PT30S") Duration checkpointInterval,
        @DefaultValue Engine engine,
        @DefaultValue Audit audit,
        @DefaultValue Metering metering,
        @DefaultValue Score score) {

    /**
     * Reputation-engine tuning. Defaults mirror the L1 adapter demos and the reference server: window
     * 10, cool after 2 consecutive failures, recover after 2 consecutive successes.
     */
    public record Engine(
            @DefaultValue("10") int windowSize,
            @DefaultValue("2") int coolAfter,
            @DefaultValue("2") int recoverAfter) {}

    /**
     * Audit-trail retention. {@code retention} is opt-in: a zero (the {@code P0D} default) or negative
     * duration means never purge, so the trail grows unbounded exactly as the reference does when the
     * knob is unset. {@code purgeInterval} is how often the purge task runs when retention is on.
     *
     * @param purgeInterval how often the retention purge runs
     * @param retention how much history to keep; {@code <= 0} disables purging
     */
    public record Audit(
            @DefaultValue("PT1H") Duration purgeInterval,
            @DefaultValue("P0D") Duration retention) {

        /** Whether age-based purging is turned on (a positive retention was configured). */
        public boolean purgeEnabled() {
            return retention != null && !retention.isZero() && !retention.isNegative();
        }
    }

    /**
     * Usage-metering rollup (issue #10). {@code flushInterval} is how often accumulated in-memory lease
     * counts are flushed to {@code usage_meter} and pool sizes sampled; a shorter interval narrows the
     * window of counts lost on a crash.
     *
     * @param flushInterval how often the metering rollup runs
     */
    public record Metering(@DefaultValue("PT1M") Duration flushInterval) {}

    /**
     * Reputation-score time-series sampling (issue #12). The {@code ScoreSampler} snapshots every live
     * cell's score into {@code score_sample} every {@code sampleInterval} — the raw points behind the
     * dashboard's 24h curve. Because that table grows per (tenant × resource × context) per tick, a
     * retention purge runs every {@code purgeInterval} and drops samples older than {@code retention}.
     * Unlike audit retention, score retention is <em>on by default</em> (a bounded time series is only
     * useful for a recent window, and the table would otherwise grow without limit); a zero or negative
     * {@code retention} disables it for callers who want to keep everything.
     *
     * @param sampleInterval how often every cell's score is sampled into {@code score_sample}
     * @param retention how much score history to keep; {@code <= 0} disables purging
     * @param purgeInterval how often the retention purge runs
     */
    public record Score(
            @DefaultValue("PT1M") Duration sampleInterval,
            @DefaultValue("P7D") Duration retention,
            @DefaultValue("PT1H") Duration purgeInterval) {

        /** Whether age-based purging is turned on (a positive retention was configured). */
        public boolean purgeEnabled() {
            return retention != null && !retention.isZero() && !retention.isNegative();
        }
    }
}
