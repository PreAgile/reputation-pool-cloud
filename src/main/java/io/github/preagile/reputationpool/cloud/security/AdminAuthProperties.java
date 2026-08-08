package io.github.preagile.reputationpool.cloud.security;

import java.time.Duration;
import java.util.List;
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
 * <p>Two kinds of login exist, separated by what they may do:
 *
 * <ul>
 *   <li><b>admin</b> ({@link #username()}/{@link #password()}) — the operator, exactly one. Its token
 *       carries {@code scope=admin} and is the only one that may write: block/unblock a resource, issue
 *       or revoke an API key, create/suspend/delete a tenant.
 *   <li><b>viewers</b> ({@link #viewers()}) — read-only demo logins, any number of them. Each token
 *       carries {@code scope=viewer}, which reaches every {@code GET}/{@code HEAD} and nothing else;
 *       {@link SecurityConfiguration} rejects any other method with 403. Optional: an empty list means
 *       no viewer token can ever be minted.
 * </ul>
 *
 * <p>Viewers exist because these credentials are published (a demo account printed on a CV). A published
 * credential must not be able to change state, so the split is enforced at the filter chain by HTTP
 * method, not by hiding buttons in the dashboard.
 *
 * <p><b>Why a list rather than one viewer.</b> Each audience gets its own credential — one per company
 * the console is shown to. That is not cosmetic: a credential handed to one audience can be retired
 * without disturbing the others, and the login name in the audit {@code sub} claim says which audience
 * a session came from. A single shared demo account loses both.
 *
 * @param username the admin login name; blank (the default) disables the console
 * @param password the admin password; blank (the default) disables the console
 * @param viewers read-only demo logins; empty (the default) means no viewer token is ever minted
 * @param tenant the tenant an admin token — and thus the operator's read model — is bound to
 * @param jwtSecret the HS256 signing secret (min 32 bytes when set); blank disables the console
 * @param tokenTtl how long an issued token stays valid
 */
@ConfigurationProperties("reputation-pool.admin")
public record AdminAuthProperties(
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue List<Viewer> viewers,
        @DefaultValue("default") String tenant,
        @DefaultValue("") String jwtSecret,
        @DefaultValue("PT1H") Duration tokenTtl) {

    /** HS256 requires a key of at least 256 bits; a shorter secret is a misconfiguration, not a policy. */
    static final int MIN_SECRET_BYTES = 32;

    /**
     * One read-only demo login.
     *
     * <p>{@code tenant} is per-viewer and blank means "same as the admin {@link
     * AdminAuthProperties#tenant()}". They are separable because the operator's console and a demo
     * usually want different data: the admin login is typically pointed at the tenant actually being
     * run, whose read model holds real resource identifiers, while a demo shown outside the team should
     * land on a tenant holding demonstration data.
     *
     * @param username the login name; blank disables this entry
     * @param password the password; blank disables this entry
     * @param tenant the tenant this viewer's token is bound to; blank means the admin tenant
     */
    public record Viewer(
            @DefaultValue("") String username,
            @DefaultValue("") String password,
            @DefaultValue("") String tenant) {

        /** Whether this entry is usable. Slots left empty by config bind as blanks and are skipped. */
        boolean usable() {
            return !username.isBlank() && !password.isBlank();
        }
    }

    /** Whether the admin console is fully configured (all secrets present) and login can succeed. */
    public boolean configured() {
        return !username.isBlank() && !password.isBlank() && !jwtSecret.isBlank();
    }

    /**
     * The viewer logins that can actually mint a token. Entries with a blank name or password are
     * dropped — config that enumerates fixed slots leaves the unused ones empty — and the whole list is
     * empty without a {@code jwtSecret}, so a console with no signing key has no viewers either: fail
     * closed, the same way {@link #configured()} works.
     */
    public List<Viewer> usableViewers() {
        if (jwtSecret.isBlank()) {
            return List.of();
        }
        return viewers.stream().filter(Viewer::usable).toList();
    }

    /** The tenant {@code viewer}'s token is bound to: its own when set, otherwise the admin tenant. */
    public String tenantFor(Viewer viewer) {
        return viewer.tenant().isBlank() ? tenant : viewer.tenant();
    }
}
