package io.github.preagile.reputationpool.cloud.policy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import java.time.Duration;
import java.util.Objects;

/**
 * One tenant's complete engine tuning (issue #179) — the six numbers
 * {@link io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry} needs to build that
 * tenant's {@link ReputationEngine} and {@link ResourcePool}. Before this existed the registry read them
 * off the single global {@link ReputationPoolProperties}, so every tenant on the instance ran the same
 * curve regardless of what its own workload looked like.
 *
 * <p><b>Why a value object rather than six parameters.</b> The upstream constructors already reject
 * every one of these ranges — {@link ReputationEngine} refuses a threshold below 1, {@link ResourcePool}
 * refuses a non-positive lease TTL, {@link AdaptiveCooldownPolicy} refuses an exponent outside
 * {@code [0, MAX_ALLOWED_EXPONENT]}, {@link WeightedRandomSelectionStrategy} refuses a floor that is not
 * finite and positive. But those run at <em>pool build</em> time, and a pool is built lazily on the
 * tenant's first reference. Storing an invalid policy would therefore succeed and then blow up as a 500
 * on that tenant's first gRPC call, with nothing pointing back at the request that caused it. Hoisting
 * the same checks into this compact constructor means the control plane rejects it with a 400 at the
 * moment it is written — the fail-fast posture {@link ReputationPoolProperties.Limits} and
 * {@link ReputationPoolProperties.SurgeThresholds} already take for operator configuration.
 *
 * <p><b>These are the structural bounds only.</b> They say what the engine can physically accept, not
 * what this instance can afford to host. The capacity-derived ceiling is a separate, configurable check
 * ({@link EnginePolicyCeiling}) applied on top at write time.
 *
 * <p><b>All-or-nothing.</b> A tenant either has a complete policy or none at all; there is no partial
 * override of individual knobs. A nullable-field merge would make "what is this tenant actually running"
 * unreadable and push validation behind the merge, where the same invalid combination could arrive from
 * several different partial writes. The control plane prefills the global defaults when an operator opens
 * the form (see {@code EnginePolicyController}), so completeness costs the caller nothing.
 *
 * @param windowSize how many recent outcomes each reputation cell retains
 * @param coolAfter consecutive failures before a resource is cooled
 * @param recoverAfter consecutive successes required to leave {@code RECOVERING}
 * @param leaseTtl how long an acquired lease stays valid before it expires
 * @param cooldownMaxExponent the exponent at which {@link AdaptiveCooldownPolicy}'s backoff tops out
 * @param explorationFloor the minimum selection weight every eligible candidate receives
 */
public record EnginePolicy(
        int windowSize,
        int coolAfter,
        int recoverAfter,
        Duration leaseTtl,
        int cooldownMaxExponent,
        double explorationFloor) {

    public EnginePolicy {
        requireAtLeastOne(windowSize, "window-size");
        requireAtLeastOne(coolAfter, "cool-after");
        requireAtLeastOne(recoverAfter, "recover-after");
        Objects.requireNonNull(leaseTtl, "lease-ttl must not be null");
        if (leaseTtl.isZero() || leaseTtl.isNegative()) {
            throw new IllegalArgumentException("lease-ttl must be > 0, but was " + leaseTtl);
        }
        // Mirrors AdaptiveCooldownPolicy's own range rather than restating the number: above the cap the
        // computed cooldown overflows Duration's nanosecond range.
        if (cooldownMaxExponent < 0 || cooldownMaxExponent > AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT) {
            throw new IllegalArgumentException("cooldown-max-exponent must be in [0, "
                    + AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT + "], but was " + cooldownMaxExponent);
        }
        if (!Double.isFinite(explorationFloor) || explorationFloor <= 0.0) {
            throw new IllegalArgumentException(
                    "exploration-floor must be a finite number > 0, but was " + explorationFloor);
        }
    }

    /**
     * The instance-wide default policy assembled from the global {@code reputation-pool.*} configuration
     * — what every tenant without a stored policy row runs, which is exactly what every tenant ran before
     * this type existed. The existing {@code engine()}/{@code leaseTtl()} accessors stay the single source
     * of those numbers, so an operator's current binding keeps working untouched.
     */
    public static EnginePolicy defaultsFrom(ReputationPoolProperties properties) {
        Objects.requireNonNull(properties, "properties must not be null");
        ReputationPoolProperties.Engine engine = properties.engine();
        return new EnginePolicy(
                engine.windowSize(),
                engine.coolAfter(),
                engine.recoverAfter(),
                properties.leaseTtl(),
                engine.cooldownMaxExponent(),
                engine.explorationFloor());
    }

    private static void requireAtLeastOne(int value, String name) {
        if (value < 1) {
            throw new IllegalArgumentException(name + " must be >= 1, but was " + value);
        }
    }
}
