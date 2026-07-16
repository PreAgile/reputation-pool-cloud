package io.github.preagile.reputationpool.cloud.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;

/**
 * Validates admin credentials and mints the HS256 control-plane token (issue #11). It lives in the
 * {@code security} package alongside the signing config so the credential and signing secrets stay in
 * one place, never leaking to the web layer.
 *
 * <p>The token carries the admin username as {@code sub} and a {@code tenant} claim — the tenant the
 * dashboard read model is scoped to (v1 single-login, no RBAC). Credential comparison is
 * constant-time ({@link MessageDigest#isEqual}) so a wrong username or password cannot be
 * distinguished by response timing. When the console is unconfigured (see {@link AdminAuthProperties})
 * {@link #issueToken} always returns empty — the console is fail-closed, never mints a token, so no
 * request can authenticate.
 */
public final class AdminTokenService {

    /** The claim carrying the tenant the issued token — and the read model it authorizes — is bound to. */
    public static final String TENANT_CLAIM = "tenant";

    private static final String ISSUER = "reputation-pool-cloud";

    private final JwtEncoder encoder;
    private final AdminAuthProperties properties;

    public AdminTokenService(JwtEncoder encoder, AdminAuthProperties properties) {
        this.encoder = Objects.requireNonNull(encoder, "encoder must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    /**
     * A signed token for the given credentials, or empty if they are wrong or the console is
     * unconfigured. The caller turns empty into 401 without revealing which check failed.
     */
    public Optional<IssuedToken> issueToken(String username, String password) {
        if (!properties.configured() || !credentialsMatch(username, password)) {
            return Optional.empty();
        }
        Instant now = Instant.now();
        Instant expiresAt = now.plus(properties.tokenTtl());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .issuedAt(now)
                .expiresAt(expiresAt)
                .subject(properties.username())
                .claim(TENANT_CLAIM, properties.tenant())
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return Optional.of(new IssuedToken(token, properties.tokenTtl().toSeconds()));
    }

    private boolean credentialsMatch(String username, String password) {
        // Compare both fields with constant-time equality; & (not &&) so timing does not leak which
        // field matched. A null field fails closed.
        boolean userOk = constantTimeEquals(properties.username(), username);
        boolean passOk = constantTimeEquals(properties.password(), password);
        return userOk & passOk;
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    /** A minted token and its lifetime in seconds — the raw token is returned to the caller once. */
    public record IssuedToken(String token, long expiresInSeconds) {}
}
