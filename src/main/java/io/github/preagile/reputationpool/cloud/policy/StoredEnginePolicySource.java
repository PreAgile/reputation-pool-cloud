package io.github.preagile.reputationpool.cloud.policy;

import java.util.Objects;

/**
 * The production {@link EnginePolicySource}: the tenant's stored policy if it has one, otherwise the
 * instance-wide default assembled from {@code reputation-pool.*}.
 *
 * <p><b>The fallback is the compatibility guarantee.</b> With no rows in {@code tenant_engine_policy} —
 * which is every tenant the moment this ships — every pool is built from exactly the numbers the
 * registry used to read straight off the properties, so the change is invisible until someone writes a
 * policy. It is also the only correct answer during onboarding: {@code TenantController.create} calls
 * {@code registry.onboard(id)} <em>before</em> inserting the tenant row, so the first lookup for a new
 * tenant necessarily finds nothing.
 *
 * <p><b>A lookup failure is propagated, not defaulted.</b> Answering a database error with the global
 * default would look like the more available choice and is the worse one: the registry caches the pool
 * it builds, so a policy silently swapped for the defaults during a transient outage would stay wrong
 * for the whole life of the process, with no signal anywhere. Failing the call lets the tenant retry
 * into a correctly built pool.
 */
public final class StoredEnginePolicySource implements EnginePolicySource {

    private final EnginePolicyRepository repository;
    private final EnginePolicy instanceDefault;

    public StoredEnginePolicySource(EnginePolicyRepository repository, EnginePolicy instanceDefault) {
        this.repository = Objects.requireNonNull(repository, "repository must not be null");
        this.instanceDefault = Objects.requireNonNull(instanceDefault, "instanceDefault must not be null");
    }

    /** The instance-wide default every tenant without a stored policy runs. */
    public EnginePolicy instanceDefault() {
        return instanceDefault;
    }

    @Override
    public EnginePolicy policyFor(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        return repository
                .findCurrent(tenantId)
                .map(EnginePolicyRevision::policy)
                .orElse(instanceDefault);
    }
}
