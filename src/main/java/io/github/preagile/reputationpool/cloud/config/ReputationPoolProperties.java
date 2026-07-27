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
 * @param limits the shared-JVM global resource budget (issue #84)
 * @param surgeThresholds the domain-surge alert thresholds published as gauges (issue #77)
 */
@ConfigurationProperties("reputation-pool")
public record ReputationPoolProperties(
        @DefaultValue("PT30S") Duration leaseTtl,
        @DefaultValue("PT30S") Duration checkpointInterval,
        @DefaultValue Engine engine,
        @DefaultValue Audit audit,
        @DefaultValue Metering metering,
        @DefaultValue Score score,
        @DefaultValue Limits limits,
        @DefaultValue SurgeThresholds surgeThresholds) {

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

    /**
     * The shared-JVM global resource budget (issue #84). The pool is in-memory and every tenant shares
     * one JVM ({@link io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry}), so an
     * unbounded tenant can grow registered resources or reputation cells until the shared heap OOMs and
     * every tenant goes down together (blast radius = all tenants).
     *
     * <p><b>Deliberately global, not per-tenant.</b> This is the sum across <em>every</em> tenant, not a
     * per-tenant ceiling: the requirement is that a single active tenant can use 100% of the JVM's
     * capacity, and several tenants share it dynamically as they show up — a fixed per-tenant cap would
     * throttle a lone tenant even when nothing else is competing for the budget. There is intentionally
     * no per-tenant field here; {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget}
     * only ever checks the running grand total against these two numbers.
     *
     * <p><b>These defaults are an unmeasured hypothesis, not a validated capacity figure</b> — no
     * production load test backs {@code 100_000} / {@code 500_000} yet. They exist so the budget is on by
     * default rather than unset, and are meant to be tuned once real per-resource/per-cell memory
     * footprint is observed in production (mirroring how {@link Engine}'s defaults mirror the reference
     * rather than a measured optimum).
     *
     * @param maxResources the global ceiling on registered resources summed across every tenant
     * @param maxCells the global ceiling on reputation cells ({@code resource × context} pairs) summed
     *     across every tenant
     */
    public record Limits(
            @DefaultValue("100000") long maxResources,
            @DefaultValue("500000") long maxCells) {

        /**
         * Fail fast on misconfiguration, the same posture as {@link
         * io.github.preagile.reputationpool.cloud.security.LoginThrottleProperties}: a non-positive
         * budget is never a valid ceiling (zero or negative would refuse every tenant instantly), so
         * reject it at boot rather than silently self-DoS-ing every tenant on the first call.
         *
         * @throws IllegalArgumentException if {@code maxResources} or {@code maxCells} is not positive
         */
        public Limits {
            if (maxResources <= 0) {
                throw new IllegalArgumentException("limits.max-resources must be > 0, but was " + maxResources);
            }
            if (maxCells <= 0) {
                throw new IllegalArgumentException("limits.max-cells must be > 0, but was " + maxCells);
            }
        }
    }

    /**
     * Thresholds for the domain-surge alert rules in {@code monitoring/alerts.yml} (issue #77), in
     * transitions per minute.
     *
     * <p><b>Why these live in the app instead of in the rule file.</b> Prometheus does not expand
     * environment variables inside rule files, so a threshold written literally into {@code alerts.yml}
     * can only be changed by editing that file and reloading. Publishing each threshold as a gauge
     * instead ({@link io.github.preagile.reputationpool.cloud.metrics.SurgeThresholdMetrics}) lets the
     * rule compare the observed rate against a configured series, so an operator retunes it the same way
     * as every other knob in this file — an environment variable — and the value is visible in Prometheus
     * and plottable next to the actual rate.
     *
     * <p><b>Both defaults are an unmeasured hypothesis</b>, exactly like {@link Limits}: no production
     * traffic backs them yet. What <em>is</em> derived rather than guessed is their <em>ratio</em>.
     * A single {@code (resource, context)} pair cannot re-enter cooling until its cooldown expires
     * (core's {@code ReputationEngine.shouldCool} refuses to repeat the event while one is active), and
     * the first cooldown is {@code base(cause) × 2^(coolAfter-1)}. With {@link Engine#coolAfter()} at 2
     * that is 60s for {@code SLOW} but 7200s for {@code BLOCKED} — a 120× spread. So the same
     * transitions-per-minute figure means "a handful of chronically slow pairs" for the aggregate rate
     * and "dozens of distinct pairs newly blocked" for {@code BLOCKED}, which is why the blocking
     * threshold is an order of magnitude lower. {@code coolingPerMinute} anchors on the existing
     * {@code ResourceBlocklistSurge} rule's 10/min so the two domain-surge rules stay comparable.
     *
     * <p>Tune once real traffic is observed: see {@code monitoring/README.md} for the derivation
     * (measure the steady-state rate, then set the threshold as a multiple of it).
     *
     * @param coolingPerMinute transitions into {@code COOLING} per minute, across all causes, above
     *     which {@code ResourceCoolingSurge} fires
     * @param blockingPerMinute transitions into {@code COOLING} caused by {@code BLOCKED} per minute
     *     above which {@code UpstreamBlockingSurge} fires
     */
    public record SurgeThresholds(
            @DefaultValue("10") double coolingPerMinute,
            @DefaultValue("1") double blockingPerMinute) {

        /**
         * Fail fast on misconfiguration, the same posture as {@link Limits}. A non-positive threshold is
         * never valid: the rules compare a rate that is {@code >= 0} against it, so zero or negative
         * would make the alert fire on any activity at all (or on none) and turn into a permanent alert
         * storm. Turning a rule off is done by removing it from {@code alerts.yml}, not by zeroing this.
         *
         * @throws IllegalArgumentException if either threshold is not positive or not finite
         */
        public SurgeThresholds {
            requirePositiveFinite(coolingPerMinute, "surge-thresholds.cooling-per-minute");
            requirePositiveFinite(blockingPerMinute, "surge-thresholds.blocking-per-minute");
        }

        private static void requirePositiveFinite(double value, String name) {
            if (!Double.isFinite(value) || value <= 0) {
                throw new IllegalArgumentException(name + " must be a finite number > 0, but was " + value);
            }
        }
    }
}
