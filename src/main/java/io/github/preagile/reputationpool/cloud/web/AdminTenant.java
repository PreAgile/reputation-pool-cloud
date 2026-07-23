package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

/**
 * Reads the server-decided tenant boundary off the validated admin JWT. security.md requires
 * tenant-scoped reads to use a server-decided tenant, not one taken from the request body or query, so
 * the dashboard read model derives its tenant only from the token's {@code tenant} claim — set by
 * {@link AdminTokenService} at login, never by the caller.
 */
final class AdminTenant {

    private AdminTenant() {}

    /** The tenant the token is bound to. A token without the claim is rejected rather than defaulted. */
    static String of(Jwt jwt) {
        String tenant = jwt.getClaimAsString(AdminTokenService.TENANT_CLAIM);
        if (tenant == null || tenant.isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "token is not bound to a tenant");
        }
        return tenant;
    }

    /**
     * Guards a write against the token's tenant scope: if {@code targetTenant} is outside the tenant the
     * token is bound to, reject with 403. Reuses {@link #of(Jwt)} so a token missing the {@code tenant}
     * claim also fails closed. The reason is a generic {@code "forbidden"} on purpose — a scoped 403 must
     * not reveal whether the target tenant exists (security.md non-disclosure). Callers must run this
     * <em>before</em> any existence check so a 404/403 difference cannot probe other tenants.
     */
    static void requireScope(Jwt jwt, String targetTenant) {
        if (!of(jwt).equals(targetTenant)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "forbidden");
        }
    }
}
