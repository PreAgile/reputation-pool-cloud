package io.github.preagile.reputationpool.cloud.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Auth configuration bound from {@code reputation-pool.auth.*}. The API key is a secret with no baked
 * default (empty when unset), so a missing value fails closed — the interceptor rejects every call
 * rather than accepting a known key.
 *
 * @param apiKey the single API key accepted in Phase 1; supplied via REPUTATION_POOL_API_KEY
 */
@ConfigurationProperties("reputation-pool.auth")
public record SecurityProperties(@DefaultValue("") String apiKey) {

    /** Whether an API key was actually configured (non-blank). */
    public boolean configured() {
        return apiKey != null && !apiKey.isBlank();
    }
}
