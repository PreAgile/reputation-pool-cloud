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
 * <p><b>Why a ceiling is needed at all — and why {@code windowSize} is the knob that needs one most.</b>
 * {@link ReputationPoolProperties.Limits} bounds the shared JVM in units of <em>cells</em>, and
 * {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget} counts cells. But a cell is
 * not a fixed-cost thing: it retains {@code windowSize} recent outcomes, so opening that knob to tenants
 * opens the one multiplier the cell budget cannot see. The heap is the smaller half of that cost. The
 * larger half is <b>checkpoint write amplification</b>, and it is worth spelling out because it is
 * measured in rows, not in guesses:
 *
 * <ul>
 *   <li>{@code PostgresResourceStore.insertCells} writes <em>one {@code cell_outcome} row per window
 *       entry per cell</em> — an ordinal loop over {@code cell.window()}.
 *   <li>{@code save()} is a whole-state replace, not a delta: it deletes this pool's {@code cell} rows
 *       (which cascades to their {@code cell_outcome} rows — the store notes that no explicit
 *       {@code DELETE FROM cell_outcome} is needed) and re-inserts everything in one transaction.
 *   <li>{@code PoolLifecycle} runs that on a fixed delay, {@code reputation-pool.checkpoint-interval},
 *       default 30s.
 * </ul>
 *
 * <p>So every 30 seconds each tenant deletes and rewrites {@code cells × windowSize} outcome rows, and
 * {@code windowSize} scales that <em>linearly</em>. A tenant with a six-figure window and only a handful
 * of cells stays far under {@code maxCells} while dominating the instance's checkpoint I/O — and because
 * a checkpoint is one transaction per tenant, it lengthens the write that every <em>other</em> tenant's
 * checkpoint is queued behind.
 *
 * <p><b>What makes that lopsided rather than merely expensive: nothing currently reads the window.</b>
 * Verified against core 0.5.0 — the only two reads of {@code ReputationCell.window()} anywhere in the
 * engine are the {@code append(...)} calls that rebuild it. Every state transition is decided by
 * {@code consecutiveFailures}/{@code consecutiveSuccesses}, which are scalar counters on the cell and
 * cost the same at any window size. {@code ReputationCell}'s javadoc says the window exists for
 * "computations that need actual recent history (p95 latency)", but no such computation exists yet. A
 * larger window today therefore buys <em>retained evidence for a future feature</em> and pays for it in
 * checkpoint I/O now. That is a real thing to want, and a poor thing to leave unbounded: this ceiling
 * should be read as "raise it deliberately, not by default", and it is the reason the default multiple is
 * a modest one rather than generous.
 *
 * <p>The other knobs are bounded for weaker reasons, and the javadoc should not pretend otherwise:
 * {@code leaseTtl} parks a resource out of rotation long after its caller is gone, and the two curve
 * knobs cost nothing but change behaviour. Only {@code windowSize} has a cost that scales with a number
 * the instance is already paying every 30 seconds.
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
 * cancels, which is worth stating rather than hiding. Per checkpoint the instance already accepted a
 * worst case of {@code maxCells × windowSize} rewritten {@code cell_outcome} rows when it accepted its
 * own configuration. Letting tenants raise the window to {@code W} makes that {@code maxCells × W}, so
 * the blow-up factor is {@code W / windowSize} — {@code maxCells} divides out. Bounding the blow-up
 * factor <em>is</em> bounding the ceiling relative to the configured default, and writing it that way
 * keeps the ceiling honest about which number it actually constrains.
 *
 * <p><b>This multiple is an unmeasured hypothesis</b>, in the same sense as
 * {@link ReputationPoolProperties.Limits}' defaults: no production load test says that 10× the instance
 * default is where an instance's checkpoint starts to hurt. What is <em>not</em> a hypothesis is the
 * shape of the cost — {@code cells × windowSize} rows rewritten per checkpoint is read off the store's
 * insert loop, not estimated — nor {@code maxCooldownMaxExponent}, which is clamped to
 * {@link AdaptiveCooldownPolicy#MAX_ALLOWED_EXPONENT}, a hard upstream limit above which the computed
 * cooldown overflows {@link Duration}. Only <em>where on that line an instance stops coping</em> is the
 * guess, which is why the multiple is configuration rather than a constant.
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
