package io.github.preagile.reputationpool.cloud.config;

import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
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
 * @param policyCeiling how far a per-tenant engine policy may depart from these defaults (issue #179)
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
        @DefaultValue SurgeThresholds surgeThresholds,
        @DefaultValue PolicyCeiling policyCeiling) {

    /**
     * Reputation-engine tuning. Defaults mirror the L1 adapter demos and the reference server: window
     * 10, cool after 2 consecutive failures, recover after 2 consecutive successes, plus the two knobs
     * upstream's no-arg constructors pick for themselves — {@code AdaptiveCooldownPolicy}'s
     * {@code DEFAULT_MAX_EXPONENT} (6) and {@code WeightedRandomSelectionStrategy}'s
     * {@code DEFAULT_EXPLORATION_FLOOR} (1.0).
     *
     * <p>Since issue #179 these are the instance-wide <em>defaults</em>, not the only possible values:
     * a tenant may store its own complete {@code EnginePolicy}, and a tenant without one runs exactly
     * these numbers. They are also what {@code EnginePolicyCeiling} derives each tenant's upper bound
     * from, which is why an out-of-range default has to fail at boot rather than at the first pool build.
     *
     * @param windowSize how many recent outcomes each reputation cell retains
     * @param coolAfter consecutive failures before a resource is cooled
     * @param recoverAfter consecutive successes required to leave {@code RECOVERING}
     * @param cooldownMaxExponent the exponent at which the adaptive cooldown's backoff tops out
     * @param explorationFloor the minimum selection weight every eligible candidate receives
     */
    public record Engine(
            @DefaultValue("10") int windowSize,
            @DefaultValue("2") int coolAfter,
            @DefaultValue("2") int recoverAfter,
            @DefaultValue("6") int cooldownMaxExponent,
            @DefaultValue("1.0") double explorationFloor) {

        /**
         * Fail fast on misconfiguration, the same posture as {@link Limits}. These are the ranges the
         * upstream {@code ReputationEngine}/{@code AdaptiveCooldownPolicy}/{@code WeightedRandomSelectionStrategy}
         * constructors enforce; without this check an out-of-range default is accepted at boot and only
         * surfaces when the first tenant's pool is lazily built, as a 500 on that tenant's first call.
         *
         * @throws IllegalArgumentException if any knob is outside the range upstream accepts
         */
        public Engine {
            requireAtLeastOne(windowSize, "engine.window-size");
            requireAtLeastOne(coolAfter, "engine.cool-after");
            requireAtLeastOne(recoverAfter, "engine.recover-after");
            if (cooldownMaxExponent < 0 || cooldownMaxExponent > AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT) {
                throw new IllegalArgumentException("engine.cooldown-max-exponent must be in [0, "
                        + AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT + "], but was " + cooldownMaxExponent);
            }
            if (!Double.isFinite(explorationFloor) || explorationFloor <= 0) {
                throw new IllegalArgumentException(
                        "engine.exploration-floor must be a finite number > 0, but was " + explorationFloor);
            }
        }

        private static void requireAtLeastOne(int value, String name) {
            if (value < 1) {
                throw new IllegalArgumentException(name + " must be >= 1, but was " + value);
            }
        }
    }

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

    /**
     * How far a per-tenant engine policy may depart from this instance's own {@link Engine}/{@link
     * #leaseTtl()} defaults (issue #179). Opening the engine knobs to tenants opens a multiplier
     * {@link Limits} cannot see — {@code windowSize} is retained outcomes <em>per cell</em>, so a tenant
     * with few cells and a huge window occupies the heap the cell budget exists to protect — and this is
     * the bound that closes it, enforced when a policy is written rather than when a pool is built.
     *
     * <p>Deliberately a <em>multiple of the configured default</em> rather than a slice of {@link Limits}.
     * Dividing the global budget by the active tenant count is exactly what
     * {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget} refused to do: it would
     * cap a lone tenant below the capacity it may use, and would make every stored policy's validity a
     * function of how many tenants happen to exist right now. A multiple of static configuration still
     * varies per instance — a smaller instance tuned down to {@code window-size: 5} caps its tenants at
     * 50 where a larger one at {@code 20} caps them at 200 — with nothing to recompute when tenants come
     * and go. The full derivation, including why {@code max-cells} cancels out of it, is on
     * {@code EnginePolicyCeiling}.
     *
     * <p><b>The default is an unmeasured hypothesis</b>, like {@link Limits}': no load test says 10× the
     * instance default is where an instance starts to hurt. It exists so the knobs are bounded rather
     * than open, and is configurable so it can be retuned once real per-cell footprint is observed.
     *
     * @param maxMultipleOfDefault the multiple of each configured default a tenant policy may reach
     *     (inclusive); the cooldown exponent is additionally clamped to upstream's hard maximum
     */
    public record PolicyCeiling(@DefaultValue("10") int maxMultipleOfDefault) {

        /** The largest multiple accepted, so scaling a default can never overflow into a nonsense bound. */
        public static final int MAX_MULTIPLE = 1_000;

        /**
         * Fail fast on misconfiguration, the same posture as {@link Limits}. A multiple below 1 would put
         * the ceiling under this instance's own default and refuse a policy identical to what every
         * tenant already runs; an unbounded one would overflow the scaled {@link Duration} bound. Turning
         * the ceiling off is not a supported configuration — that is what the bound exists to prevent.
         *
         * @throws IllegalArgumentException if the multiple is outside {@code [1, MAX_MULTIPLE]}
         */
        public PolicyCeiling {
            if (maxMultipleOfDefault < 1 || maxMultipleOfDefault > MAX_MULTIPLE) {
                throw new IllegalArgumentException("policy-ceiling.max-multiple-of-default must be in [1, "
                        + MAX_MULTIPLE + "], but was " + maxMultipleOfDefault);
            }
        }
    }
}
