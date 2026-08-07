package io.github.preagile.reputationpool.cloud.security;

import io.github.preagile.reputationpool.cloud.security.AdminAuthProperties.Account;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
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
 * <p>The token carries the matched account's username as {@code sub} plus two server-decided claims: the
 * {@code tenant} the dashboard read model is scoped to, and (issue #31) the {@code role} that decides
 * whether the token may write. Both come from configuration at login and are never read from the
 * request, so a caller cannot widen its own tenant scope or its own authority.
 *
 * <p><b>Constant-time across every account.</b> Credential comparison uses
 * {@link MessageDigest#isEqual}, and the loop over the configured accounts deliberately does not
 * short-circuit: every account is compared on every attempt, and both fields of each are compared with
 * {@code &} rather than {@code &&}. So response timing reveals neither which field was wrong nor which
 * account (if any) the username belongs to — the multi-account version of the property the single-login
 * implementation had.
 *
 * <p>When the console is unconfigured (see {@link AdminAuthProperties}) {@link #issueToken} always
 * returns empty — the console is fail-closed, never mints a token, so no request can authenticate.
 */
public final class AdminTokenService {

    /** The claim carrying the tenant the issued token — and the read model it authorizes — is bound to. */
    public static final String TENANT_CLAIM = "tenant";

    /**
     * The claim carrying the issued token's {@link AdminRole} (issue #31). Read by
     * {@link AdminWriteAuthorizationFilter} to admit or refuse mutating requests; a token without it has
     * no write authority at all.
     */
    public static final String ROLE_CLAIM = "role";

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
     * A signed token for the given credentials, or empty if they match no configured account or the
     * console is unconfigured. The caller turns empty into 401 without revealing which check failed.
     */
    public Optional<IssuedToken> issueToken(String username, String password) {
        if (!properties.configured()) {
            return Optional.empty();
        }
        Account matched = match(properties.allAccounts(), username, password);
        if (matched == null) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.tokenTtl());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .issuedAt(now)
                .expiresAt(expiresAt)
                .subject(matched.username())
                .claim(TENANT_CLAIM, matched.tenant())
                .claim(ROLE_CLAIM, matched.role().claimValue())
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return Optional.of(new IssuedToken(token, properties.tokenTtl().toSeconds()));
    }

    /**
     * The account these credentials authenticate as, or null. Every account is compared even after a
     * match so the work done is a function of how many accounts are configured, not of which one (or
     * none) matched. Duplicate usernames are a misconfiguration; the last match wins, deterministically.
     */
    private static Account match(List<Account> accounts, String username, String password) {
        Account matched = null;
        for (Account account : accounts) {
            // & (not &&) so timing does not leak which field matched. A null field fails closed.
            boolean userOk = constantTimeEquals(account.username(), username);
            boolean passOk = constantTimeEquals(account.password(), password);
            if (userOk & passOk) {
                matched = account;
            }
        }
        return matched;
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
