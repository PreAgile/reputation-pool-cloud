package io.github.preagile.reputationpool.cloud.security;

import java.util.Optional;

/**
 * Resolves which tenant owns a presented API key, given the key's SHA-256 digest. This is the seam the
 * auth interceptor authenticates against: a present result is an active (non-revoked) key mapped to
 * its tenant; {@link Optional#empty()} means "no such active key" and the interceptor fails closed.
 * Issue #9b routes each call to the resolved tenant's pool namespace.
 */
public interface TenantResolver {

    /**
     * @param keyHash SHA-256 of the presented {@code x-api-key}
     * @return the owning tenant id, or empty if no active (non-revoked) key has this hash
     */
    Optional<String> resolveByKeyHash(byte[] keyHash);
}
