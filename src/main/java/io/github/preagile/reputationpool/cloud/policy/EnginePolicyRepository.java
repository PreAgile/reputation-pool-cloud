package io.github.preagile.reputationpool.cloud.policy;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Durable per-tenant engine policies (issue #179), stored append-only in {@code tenant_engine_policy}.
 *
 * <p><b>Why append-only rather than a mutable row.</b> The requirement is that a policy change leaves a
 * trail of who changed what to what and when. Three shapes were available. Overwriting a single row per
 * tenant is the smallest, but it destroys the previous value on every write — the trail would have to be
 * reconstructed from somewhere else. A second history table alongside a current-value table keeps reads
 * trivial but introduces two writes that can disagree, and nothing in the schema forces them to stay in
 * step. Reusing {@code audit_event} was rejected on a harder ground: that table is upstream's (V2), keyed
 * by {@code pool_id} and written by {@code PostgresAuditTrail} as {@code PoolEvent}s, so putting a
 * control-plane row shape into it means inventing a parallel meaning for an upstream-owned table — the
 * kind of cloud-side workaround {@code AGENTS.md} rules out.
 *
 * <p>Append-only leaves one table with one write path (an {@code INSERT}) and one read path (the highest
 * revision). Because nothing is ever updated there is no lost-update race to reason about, and because
 * the primary key is {@code (tenant_id, revision)} two racing writers cannot both land on the same
 * revision — the loser gets a unique violation and is told to re-read, rather than silently overwriting
 * a change it never saw.
 */
public interface EnginePolicyRepository {

    /**
     * The tenant's current policy — the highest revision — or empty if it has never had one written.
     * Empty is the normal state: it means the tenant runs the instance-wide defaults.
     */
    Optional<EnginePolicyRevision> findCurrent(String tenantId);

    /**
     * Appends a new revision, numbered one past the tenant's current highest.
     *
     * @throws EnginePolicyConflictException if a concurrent write took the same revision number
     */
    EnginePolicyRevision append(String tenantId, EnginePolicy policy, String changedBy, Instant changedAt);

    /** The tenant's revisions, newest first, capped at {@code limit} — the change history for one tenant. */
    List<EnginePolicyRevision> history(String tenantId, int limit);
}
