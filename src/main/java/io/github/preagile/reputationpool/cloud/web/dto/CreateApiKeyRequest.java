package io.github.preagile.reputationpool.cloud.web.dto;

/** Issue-key body: an optional human label to tell a tenant's keys apart in listings. */
public record CreateApiKeyRequest(String label) {}
