package io.github.preagile.reputationpool.cloud.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Admin-console auth configuration bound from {@code reputation-pool.admin.*} — the credentials and
 * signing material for the REST control plane's JWT login (issue #11).
 *
 * <p>All three secrets ({@code username}, {@code password}, {@code jwtSecret}) come from env / a secret
 * manager, never a committed default (security.md). When any of them is unset the console is
 * <b>disabled, fail closed</b>: {@code POST /api/auth/login} cannot succeed, so no token is ever
 * minted, and every {@code /api/**} call is rejected as unauthenticated. This does not stop the app —
 * the gRPC data plane (its own {@code x-api-key} auth) still serves — it only locks the admin surface
 * until an operator configures it.
 *
 * <p>There are exactly two credentials, both bound to the same {@link #tenant()} and separated only by
 * what they may do:
 *
 * <ul>
 *   <li><b>admin</b> ({@link #username()}/{@link #password()}) — the operator. Its token carries
 *       {@code scope=admin} and is the only one that may write: block/unblock a resource, issue or
 *       revoke an API key, create/suspend/delete a tenant.
 *   <li><b>viewer</b> ({@link #viewerUsername()}/{@link #viewerPassword()}) — a read-only demo login for
 *       showing the console to someone outside the team. Its token carries {@code scope=viewer}, which
 *       reaches every {@code GET} and nothing else; {@link SecurityConfiguration} rejects any other
 *       method with 403. Optional: leave both blank and no viewer token can ever be minted.
 * </ul>
 *
 * <p>The viewer exists because the console's credentials are published (a demo account on a CV). A
 * published credential must not be able to change state, so the split is enforced at the filter chain
 * by HTTP method, not by hiding buttons in the dashboard. There is still no per-tenant RBAC: both
 * logins see the one {@link #tenant()} they are bound to.
 *
 * @param username the admin login name; blank (the default) disables the console
 * @param password the admin password; blank (the default) disables the console
 * @param viewerUsername the read-only login name; blank (the default) disables the viewer
 * @param viewerPassword the read-only password; blank (the default) disables the viewer
 * @param tenant the tenant the issued token — and thus the dashboard read model — is bound to
 * @param jwtSecret the HS256 signing secret (min 32 bytes when set); blank disables the console
 * @param tokenTtl how long an issued token stays valid
 */
@ConfigurationProperties("reputation-pool.admin")
public record AdminAuthProperties(
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue("") String viewerUsername,
        @DefaultValue("") String viewerPassword,
        @DefaultValue("default") String tenant,
        @DefaultValue("") String jwtSecret,
        @DefaultValue("PT1H") Duration tokenTtl) {

    /** HS256 requires a key of at least 256 bits; a shorter secret is a misconfiguration, not a policy. */
    static final int MIN_SECRET_BYTES = 32;

    /** Whether the admin console is fully configured (all secrets present) and login can succeed. */
    public boolean configured() {
        return !username.isBlank() && !password.isBlank() && !jwtSecret.isBlank();
    }

    /**
     * Whether the read-only viewer login is configured. It needs the same signing secret as admin, so a
     * console with no {@code jwtSecret} has no viewer either — fail closed, same as {@link #configured()}.
     */
    public boolean viewerConfigured() {
        return !viewerUsername.isBlank() && !viewerPassword.isBlank() && !jwtSecret.isBlank();
    }
}
