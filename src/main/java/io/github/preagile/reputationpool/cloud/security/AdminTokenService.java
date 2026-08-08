package io.github.preagile.reputationpool.cloud.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
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
 * <p>The token carries the login name as {@code sub}, a {@code tenant} claim — the tenant the dashboard
 * read model is scoped to — and a {@code scope} claim naming what the token may do. {@code scope} is the
 * claim Spring Security's default converter turns into {@code SCOPE_*} authorities, so
 * {@link SecurityConfiguration} can authorize on it without a custom converter: {@link #SCOPE_ADMIN}
 * reaches every endpoint, {@link #SCOPE_VIEWER} reaches reads only.
 *
 * <p>Credential comparison is constant-time ({@link MessageDigest#isEqual}) so a wrong username or
 * password cannot be distinguished by response timing, and <em>both</em> credential sets are always
 * compared — returning early on an admin match would leak, by timing, which account a caller hit. When
 * the console is unconfigured (see {@link AdminAuthProperties}) {@link #issueToken} always returns empty
 * — the console is fail-closed, never mints a token, so no request can authenticate.
 */
public final class AdminTokenService {

    /** The claim carrying the tenant the issued token — and the read model it authorizes — is bound to. */
    public static final String TENANT_CLAIM = "tenant";

    /**
     * The claim naming what the token may do. Spring Security's {@code JwtGrantedAuthoritiesConverter}
     * reads exactly this claim by default and prefixes each value with {@code SCOPE_}.
     */
    public static final String SCOPE_CLAIM = "scope";

    /** Full control plane: reads plus every write (block, API keys, tenant lifecycle). */
    public static final String SCOPE_ADMIN = "admin";

    /** Read-only: every {@code GET} under {@code /api/**} and nothing else. */
    public static final String SCOPE_VIEWER = "viewer";

    private static final String ISSUER = "reputation-pool-cloud";

    private final JwtEncoder encoder;
    private final AdminAuthProperties properties;
    private final Clock clock;

    public AdminTokenService(JwtEncoder encoder, AdminAuthProperties properties, Clock clock) {
        this.encoder = Objects.requireNonNull(encoder, "encoder must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /**
     * A signed token for the given credentials, or empty if they are wrong or the console is
     * unconfigured. The caller turns empty into 401 without revealing which check failed.
     */
    public Optional<IssuedToken> issueToken(String username, String password) {
        // Evaluate both credential sets unconditionally — & and no early return — so response timing does
        // not reveal which account was attempted. Admin wins if somehow both are configured identically.
        boolean adminOk = properties.configured() & matchesAdmin(username, password);
        boolean viewerOk = properties.viewerConfigured() & matchesViewer(username, password);
        if (!adminOk && !viewerOk) {
            return Optional.empty();
        }
        String scope = adminOk ? SCOPE_ADMIN : SCOPE_VIEWER;
        String subject = adminOk ? properties.username() : properties.viewerUsername();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.tokenTtl());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .issuedAt(now)
                .expiresAt(expiresAt)
                .subject(subject)
                .claim(TENANT_CLAIM, properties.tenant())
                .claim(SCOPE_CLAIM, scope)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return Optional.of(new IssuedToken(token, properties.tokenTtl().toSeconds(), scope));
    }

    private boolean matchesAdmin(String username, String password) {
        // Compare both fields with constant-time equality; & (not &&) so timing does not leak which
        // field matched. A null field fails closed.
        boolean userOk = constantTimeEquals(properties.username(), username);
        boolean passOk = constantTimeEquals(properties.password(), password);
        return userOk & passOk;
    }

    private boolean matchesViewer(String username, String password) {
        boolean userOk = constantTimeEquals(properties.viewerUsername(), username);
        boolean passOk = constantTimeEquals(properties.viewerPassword(), password);
        return userOk & passOk;
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * A minted token, its lifetime in seconds, and the scope it was minted with — the raw token is
     * returned to the caller once. {@code scope} is echoed to the dashboard so it can render read-only
     * affordances; it is a convenience, never the enforcement point (the filter chain is).
     */
    public record IssuedToken(String token, long expiresInSeconds, String scope) {}
}
