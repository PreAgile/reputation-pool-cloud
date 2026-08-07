package io.github.preagile.reputationpool.cloud.security;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Admin-console auth configuration bound from {@code reputation-pool.admin.*} — the credentials and
 * signing material for the REST control plane's JWT login (issue #11).
 *
 * <p>All secrets ({@code username}, {@code password}, every {@code accounts[].password}, and
 * {@code jwtSecret}) come from env / a secret manager, never a committed default (security.md). When the
 * signing secret is unset, or no account is fully configured, the console is <b>disabled, fail closed</b>:
 * {@code POST /api/auth/login} cannot succeed, so no token is ever minted, and every {@code /api/**} call
 * is rejected as unauthenticated. This does not stop the app — the gRPC data plane (its own
 * {@code x-api-key} auth) still serves — it only locks the admin surface until an operator configures it.
 *
 * <p><b>From one login to several, with roles (issue #31, first slice).</b> v1 was deliberately
 * single-login with no RBAC: one admin credential, bound to one tenant that the dashboard read model is
 * scoped to. That is now the <em>first</em> of possibly several accounts:
 *
 * <ul>
 *   <li>The flat {@link #username()}/{@link #password()}/{@link #tenant()} triple is unchanged and still
 *       means exactly what it did — a full-power ({@link AdminRole#ADMIN}) login. An existing deployment
 *       that sets only those keys behaves identically to before.
 *   <li>{@link #accounts()} adds any number of further logins, each with its own tenant binding and its
 *       own {@link AdminRole}. This is what makes a read-only (observer/demo) login possible without
 *       weakening the operator credential — see {@link AdminWriteAuthorizationFilter} for how the role is
 *       enforced.
 * </ul>
 *
 * <p>Tenant/key <em>management</em> is still a global operator action; per-tenant management scoping is
 * the remainder of #31.
 *
 * @param username the legacy single admin login name; blank means no legacy account
 * @param password the legacy single admin password; blank means no legacy account
 * @param tenant the tenant the legacy account's token — and thus its dashboard read model — is bound to
 * @param jwtSecret the HS256 signing secret (min 32 bytes when set); blank disables the console entirely
 * @param tokenTtl how long an issued token stays valid
 * @param accounts additional logins, each with its own tenant and role; empty (the default) means none
 */
@ConfigurationProperties("reputation-pool.admin")
public record AdminAuthProperties(
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue("default") String tenant,
        @DefaultValue("") String jwtSecret,
        @DefaultValue("PT1H") Duration tokenTtl,
        List<Account> accounts) {

    /** HS256 requires a key of at least 256 bits; a shorter secret is a misconfiguration, not a policy. */
    static final int MIN_SECRET_BYTES = 32;

    /** An unset {@code accounts} list binds to null; normalise it so callers never branch on null. */
    public AdminAuthProperties {
        accounts = accounts == null ? List.of() : List.copyOf(accounts);
    }

    /**
     * One admin login. Every field is required for the account to count as usable — an entry missing a
     * username or a password is dropped by {@link AdminAuthProperties#allAccounts()} rather than admitted
     * with a blank credential, so a half-written config can never produce a login that matches an empty
     * password.
     *
     * <p>{@code role} defaults to the <em>least</em> privilege ({@link AdminRole#READ_ONLY}): granting
     * write authority must be a deliberate act of configuration, and a typo in the key must fail towards
     * less power, not more.
     *
     * @param username the login name; blank disables this entry
     * @param password the login password; blank disables this entry
     * @param tenant the tenant this account's token is bound to (its dashboard read-model scope)
     * @param role what the account may do; defaults to read-only
     */
    public record Account(
            @DefaultValue("") String username,
            @DefaultValue("") String password,
            @DefaultValue("default") String tenant,
            @DefaultValue("read-only") AdminRole role) {

        /** Whether this entry carries both halves of a credential and can therefore be logged into. */
        boolean usable() {
            return username != null && !username.isBlank() && password != null && !password.isBlank() && role != null;
        }
    }

    /**
     * Every login that can actually be authenticated, legacy account first. The legacy triple is mapped
     * to an {@link AdminRole#ADMIN} account so that the old configuration keeps its old (full) authority
     * — its role is intentionally not configurable, because changing what an existing key means would be
     * a silent behaviour change for every current deployment.
     *
     * <p>Unusable entries are dropped here rather than at binding time so that a partially-filled
     * {@code accounts[n]} disables just that login instead of refusing to start the whole app (which
     * would also take the gRPC data plane down with it).
     */
    public List<Account> allAccounts() {
        List<Account> all = new ArrayList<>();
        Account legacy = new Account(username, password, tenant, AdminRole.ADMIN);
        if (legacy.usable()) {
            all.add(legacy);
        }
        for (Account account : accounts) {
            if (account.usable()) {
                all.add(account);
            }
        }
        return List.copyOf(all);
    }

    /** Whether the admin console is fully configured (signing secret + at least one login) and login can succeed. */
    public boolean configured() {
        return !jwtSecret.isBlank() && !allAccounts().isEmpty();
    }
}
