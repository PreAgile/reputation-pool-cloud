package io.github.preagile.reputationpool.cloud.security;

import java.util.Locale;
import java.util.Optional;

/**
 * What an admin console login is allowed to do (issue #31, first slice). v1 had exactly one credential
 * with implicit full power; this is the smallest role split that makes a demo/observer login safe to
 * hand out: {@link #ADMIN} keeps the v1 behaviour, {@link #READ_ONLY} may read the dashboard but may not
 * change anything.
 *
 * <p>The role travels as a JWT claim minted at login ({@link AdminTokenService#ROLE_CLAIM}), never as a
 * request field — the same rule the {@code tenant} claim follows, for the same reason: a caller must not
 * be able to name its own authority. Enforcement is one server-side gate,
 * {@link AdminWriteAuthorizationFilter}; the dashboard hiding buttons is cosmetics on top of it.
 *
 * <p>{@link #fromClaim(String)} is deliberately strict: a missing, blank or unrecognised claim resolves
 * to empty, and the gate treats empty as "may not write" (security.md fail closed). A token minted
 * before this feature shipped therefore keeps reading but loses writes until its holder logs in again —
 * chosen over defaulting an unknown claim to full power.
 */
public enum AdminRole {

    /** Full control plane access — the v1 single-login behaviour, unchanged. */
    ADMIN(true),

    /** Read-only: every safe (non-mutating) request is allowed, every write is refused with 403. */
    READ_ONLY(false);

    private final boolean writer;

    AdminRole(boolean writer) {
        this.writer = writer;
    }

    /** Whether this role may issue mutating control-plane requests. */
    public boolean canWrite() {
        return writer;
    }

    /**
     * The value carried in the token's role claim — the enum name lowercased with {@code _} as {@code -}
     * ({@code admin}, {@code read-only}), so the wire form matches how the role is spelled in
     * configuration and stays readable in a decoded token.
     */
    public String claimValue() {
        return name().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    /**
     * The role a token claim names, or empty when the claim is absent, blank or not a role this build
     * knows. Callers must treat empty as "no write authority" rather than substituting a default.
     */
    public static Optional<AdminRole> fromClaim(String claim) {
        if (claim == null || claim.isBlank()) {
            return Optional.empty();
        }
        for (AdminRole role : values()) {
            if (role.claimValue().equals(claim)) {
                return Optional.of(role);
            }
        }
        return Optional.empty();
    }
}
