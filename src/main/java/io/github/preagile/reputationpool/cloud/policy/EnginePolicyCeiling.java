package io.github.preagile.reputationpool.cloud.policy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import java.time.Duration;
import java.util.Objects;

/**
 * The upper bound a tenant's {@link EnginePolicy} may not cross on <em>this</em> instance (issue #179).
 * {@link EnginePolicy}'s own compact constructor says what the engine can physically accept; this says
 * what the instance can afford to host, and it is checked when a policy is <em>written</em> so a
 * refusal is a 400 on that request rather than a surprise at the tenant's next pool build.
 *
 * <p><b>Why a ceiling is needed at all.</b> {@link ReputationPoolProperties.Limits} bounds the shared
 * JVM in units of <em>cells</em>, and {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget}
 * counts cells. But a cell's memory footprint is not constant: it retains {@code windowSize} recent
 * outcomes. Opening {@code windowSize} to tenants therefore opens the one multiplier the global budget
 * cannot see — a tenant with a handful of cells and a six-figure window stays far under {@code maxCells}
 * while occupying the heap the budget was written to protect. The same shape applies to {@code leaseTtl}
 * (an absurd TTL parks a resource out of rotation long after the caller is gone) and to the two curve
 * knobs, whose cost is behavioural rather than memory.
 *
 * <p><b>Why the bound is not "the budget divided by the active tenant count".</b> That is the design
 * {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget} deliberately refused, and
 * its reasons are unchanged: dividing would cap a lone tenant below the capacity it is entitled to use,
 * and it would make every ceiling a function of a number that changes whenever a tenant is created or
 * deleted — so every stored policy would silently become invalid (or newly valid) without anyone
 * writing to it. There is still no per-tenant slice of the global budget anywhere in this design.
 *
 * <p><b>What the bound is derived from instead.</b> Each ceiling is a multiple of <em>this instance's
 * own configured default</em> for the same knob, with the multiple set by the operator
 * ({@code reputation-pool.policy-ceiling.max-multiple-of-default}). Two properties follow: instances
 * configured differently get different ceilings (a small instance tuned down to
 * {@code window-size: 5} caps tenants at 50 where a larger one at {@code 20} caps them at 200), and
 * nothing is recomputed when tenants come and go — the inputs are static configuration read once at boot.
 *
 * <p><b>Why {@code maxCells} does not appear in the formula.</b> It was the obvious candidate and it
 * cancels, which is worth stating rather than hiding. The instance implicitly accepted a worst case of
 * {@code maxCells × windowSize} retained outcomes when it accepted its own configuration. Letting
 * tenants raise the window to {@code W} makes that worst case {@code maxCells × W}, so the blow-up
 * factor is {@code W / windowSize} — {@code maxCells} divides out. Bounding the blow-up factor
 * <em>is</em> bounding the ceiling relative to the configured default, and writing it that way keeps the
 * ceiling honest about which number it actually constrains.
 *
 * <p><b>This multiple is an unmeasured hypothesis</b>, in the same sense as
 * {@link ReputationPoolProperties.Limits}' defaults: no production load test says that 10× the instance
 * default is where an instance starts to hurt. It is a bound chosen so the knob is <em>bounded</em>
 * rather than open, and it is configurable precisely so it can be retuned once real per-cell footprint
 * is observed. What is <em>not</em> a hypothesis is {@code maxCooldownMaxExponent}: that one is clamped
 * to {@link AdaptiveCooldownPolicy#MAX_ALLOWED_EXPONENT}, a hard upstream limit above which the computed
 * cooldown overflows {@link Duration}.
 *
 * <p><b>One place, on purpose (issue #179, decision 5).</b> Plan-based ceilings — a paid tier allowed a
 * larger window than a free one — are not implemented and there is deliberately no {@code plan} column
 * in {@code V105}. They do not need one: a plan would change how the bound is <em>derived</em>, and every
 * derivation lives in {@link #from(ReputationPoolProperties)}. Adding the tier later means giving that
 * factory a second argument and giving the write path the caller's plan, not migrating the table again.
 */
public record EnginePolicyCeiling(
        int maxWindowSize,
        int maxCoolAfter,
        int maxRecoverAfter,
        Duration maxLeaseTtl,
        int maxCooldownMaxExponent,
        double maxExplorationFloor) {

    /**
     * Derives this instance's ceiling from its static configuration: each bound is the configured global
     * default for that knob times {@code policy-ceiling.max-multiple-of-default}, except the cooldown
     * exponent, which is additionally clamped to upstream's hard maximum.
     */
    public static EnginePolicyCeiling from(ReputationPoolProperties properties) {
        Objects.requireNonNull(properties, "properties must not be null");
        EnginePolicy defaults = EnginePolicy.defaultsFrom(properties);
        int multiple = properties.policyCeiling().maxMultipleOfDefault();
        return new EnginePolicyCeiling(
                scale(defaults.windowSize(), multiple),
                scale(defaults.coolAfter(), multiple),
                scale(defaults.recoverAfter(), multiple),
                defaults.leaseTtl().multipliedBy(multiple),
                Math.min(scale(defaults.cooldownMaxExponent(), multiple), AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT),
                defaults.explorationFloor() * multiple);
    }

    /**
     * Refuses a policy this instance will not host. Every bound is inclusive: a policy sitting exactly on
     * the ceiling is accepted, so the boundary is a value an operator can actually configure rather than
     * one they have to stay under by an unstated margin.
     *
     * @throws IllegalArgumentException naming the offending knob, its value and its bound — the message
     *     is surfaced to the caller as the 400's detail, so it has to say which number to change
     */
    public void check(EnginePolicy policy) {
        Objects.requireNonNull(policy, "policy must not be null");
        requireAtMost(policy.windowSize(), maxWindowSize, "window-size");
        requireAtMost(policy.coolAfter(), maxCoolAfter, "cool-after");
        requireAtMost(policy.recoverAfter(), maxRecoverAfter, "recover-after");
        if (policy.leaseTtl().compareTo(maxLeaseTtl) > 0) {
            throw exceeded("lease-ttl", policy.leaseTtl(), maxLeaseTtl);
        }
        requireAtMost(policy.cooldownMaxExponent(), maxCooldownMaxExponent, "cooldown-max-exponent");
        if (policy.explorationFloor() > maxExplorationFloor) {
            throw exceeded("exploration-floor", policy.explorationFloor(), maxExplorationFloor);
        }
    }

    private static void requireAtMost(int value, int max, String name) {
        if (value > max) {
            throw exceeded(name, value, max);
        }
    }

    private static IllegalArgumentException exceeded(String name, Object value, Object max) {
        return new IllegalArgumentException(name + " must be <= " + max + " on this instance, but was " + value);
    }

    /** Saturating multiply: an operator's large multiple must widen the ceiling, never wrap it negative. */
    private static int scale(int base, int multiple) {
        long scaled = (long) base * multiple;
        return (int) Math.min(scaled, Integer.MAX_VALUE);
    }
}
