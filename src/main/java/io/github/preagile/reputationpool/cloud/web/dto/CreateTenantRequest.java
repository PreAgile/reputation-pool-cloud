package io.github.preagile.reputationpool.cloud.web.dto;

/**
 * Create-tenant body. {@code id} is the stable tenant key (also the {@code api_key.tenant_id} and pool
 * namespace); {@code name} is an optional human label that defaults to the id when omitted.
 */
public record CreateTenantRequest(String id, String name) {}
