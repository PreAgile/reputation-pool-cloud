package io.github.preagile.reputationpool.cloud.policy;

import java.time.Instant;
import java.util.Objects;

/**
 * One row of {@code tenant_engine_policy}: a policy as it stood from the moment it was written until the
 * next revision replaced it. The table is append-only, so a revision is never updated or deleted (except
 * by the tenant delete cascade) and the change history <em>is</em> the table — who changed a tenant's
 * policy, when, and from what to what is read by comparing consecutive revisions.
 *
 * @param tenantId the tenant this policy belongs to
 * @param revision 1 for the first policy ever written for the tenant, incrementing thereafter
 * @param policy the complete policy as of this revision
 * @param changedBy the admin subject that wrote it, taken from the validated token — never the request body
 * @param changedAt when it was written
 */
public record EnginePolicyRevision(
        String tenantId, int revision, EnginePolicy policy, String changedBy, Instant changedAt) {

    public EnginePolicyRevision {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(policy, "policy must not be null");
        Objects.requireNonNull(changedBy, "changedBy must not be null");
        Objects.requireNonNull(changedAt, "changedAt must not be null");
        if (revision < 1) {
            throw new IllegalArgumentException("revision must be >= 1, but was " + revision);
        }
    }
}
