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
 * <p>v1 is deliberately single-login with no RBAC: one admin credential, bound to one {@link #tenant()}
 * that the dashboard read model is scoped to. Tenant/key <em>management</em> is a global operator
 * action in v1; per-tenant admin accounts and roles are a follow-up.
 *
 * @param username the admin login name; blank (the default) disables the console
 * @param password the admin password; blank (the default) disables the console
 * @param tenant the tenant the issued token — and thus the dashboard read model — is bound to
 * @param jwtSecret the HS256 signing secret (min 32 bytes when set); blank disables the console
 * @param tokenTtl how long an issued token stays valid
 */
@ConfigurationProperties("reputation-pool.admin")
public record AdminAuthProperties(
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue("default") String tenant,
        @DefaultValue("") String jwtSecret,
        @DefaultValue("PT1H") Duration tokenTtl) {

    /** HS256 requires a key of at least 256 bits; a shorter secret is a misconfiguration, not a policy. */
    static final int MIN_SECRET_BYTES = 32;

    /** Whether the admin console is fully configured (all secrets present) and login can succeed. */
    public boolean configured() {
        return !username.isBlank() && !password.isBlank() && !jwtSecret.isBlank();
    }
}
