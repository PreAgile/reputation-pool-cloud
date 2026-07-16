package io.github.preagile.reputationpool.cloud.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Auth configuration bound from {@code reputation-pool.auth.*}. The API key is a secret with no baked
 * default (empty when unset). It feeds the {@link ApiKeySeeder}, not the auth decision: when set it
 * seeds the default tenant's key on startup; when unset nothing is seeded, so the {@code api_key} table
 * stays empty and the interceptor rejects every call (fail closed).
 *
 * @param apiKey the single API key seeded for the default tenant; supplied via REPUTATION_POOL_API_KEY
 */
@ConfigurationProperties("reputation-pool.auth")
public record SecurityProperties(@DefaultValue("") String apiKey) {

    /** Whether an API key was actually configured (non-blank). */
    public boolean configured() {
        return apiKey != null && !apiKey.isBlank();
    }
}
