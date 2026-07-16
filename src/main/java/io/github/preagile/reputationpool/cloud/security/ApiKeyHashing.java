package io.github.preagile.reputationpool.cloud.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * SHA-256 of an API key — the single one-way transform shared by the interceptor's lookup and the
 * seeder's at-rest write, so a key is never compared or stored in the clear. A fast digest is the
 * right choice here (not a password KDF): API keys are high-entropy random tokens, so brute-forcing a
 * 256-bit value is infeasible regardless of hash speed, and a KDF would only slow every request.
 */
final class ApiKeyHashing {

    private ApiKeyHashing() {}

    static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a required JDK algorithm; its absence is a broken runtime, not a normal error.
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
