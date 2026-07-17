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
}
