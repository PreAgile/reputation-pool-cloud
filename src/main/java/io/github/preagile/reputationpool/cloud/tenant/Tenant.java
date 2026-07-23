package io.github.preagile.reputationpool.cloud.tenant;

import java.time.Instant;

/**
 * A hosting tenant — the unit of isolation cloud owns (the public engine has no tenant concept). Rows
 * live in the cloud-owned {@code tenant} table (migration {@code V100__tenant_identity.sql}); the
 * control plane (#11) creates them and per-tenant pool routing (#9b) keys off them.
 *
 * @param id the stable tenant identifier, also the {@code api_key.tenant_id} and pool namespace key
 * @param name human-readable label
 * @param status lifecycle state (see {@link TenantStatus})
 * @param createdAt when the tenant was created
 */
public record Tenant(String id, String name, TenantStatus status, Instant createdAt) {}
