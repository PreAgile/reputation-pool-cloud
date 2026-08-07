package io.github.preagile.reputationpool.cloud.policy;

/**
 * Where {@link io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry} gets the policy to
 * build a tenant's pool with (issue #179). A seam rather than a direct repository dependency for two
 * reasons: the fallback to the instance-wide default belongs to the lookup, not to the registry (the
 * registry should just be handed the effective policy), and the registry's Docker-free unit test can
 * drive per-tenant policies without a database — the same reason its store arrives as a factory.
 *
 * <p>Implementations must always return a policy. "This tenant has nothing stored" is answered with the
 * instance default, never with {@code null} or an exception: {@code TenantController.create} onboards a
 * tenant into the registry <em>before</em> inserting its row, so the very first lookup for a brand-new
 * tenant necessarily finds nothing.
 */
@FunctionalInterface
public interface EnginePolicySource {

    /** The policy that tenant's pool should be built with; never {@code null}. */
    EnginePolicy policyFor(String tenantId);
}
