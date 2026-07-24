package io.github.preagile.reputationpool.cloud.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Blocks control-plane (REST) access for a token whose bound tenant is not {@code ACTIVE} (issue #83).
 * {@link JdbcTenantResolver}'s {@code status = 'active'} join already stops the gRPC data plane for a
 * suspended/deleted tenant; without this filter, a valid, unexpired admin JWT still passed every REST
 * endpoint regardless of its tenant's lifecycle state — including {@code POST
 * /api/tenants/{id}/reactivate} itself, which would let a suspended tenant undo its own suspension.
 *
 * <p>Runs after {@code BearerTokenAuthenticationFilter} ({@link SecurityConfiguration}'s {@code
 * addFilterAfter}), so the JWT is already signature/expiry-validated and {@link SecurityContextHolder}
 * carries the resulting {@link JwtAuthenticationToken} — this adds one more check on top of that: the
 * token's {@code tenant} claim must resolve to an {@code ACTIVE} row. A request with no {@link
 * JwtAuthenticationToken} yet (an anonymous/public path, or one rejected earlier) is left untouched; a
 * present-but-missing/blank {@code tenant} claim is left to {@code AdminTenant.of}'s existing fail-closed
 * handling downstream, so this filter only concerns itself with a present tenant that is not active.
 *
 * <p>The rejection reason is deliberately generic, but need not hide <em>which</em> lifecycle state the
 * caller's own tenant is in — security.md's non-disclosure principle is about not revealing whether
 * <em>another</em> tenant exists, not about the caller's own, already-known identity.
 */
public final class TenantStatusFilter extends OncePerRequestFilter {

    private final TenantRepository tenants;
    private final ObjectMapper objectMapper;

    public TenantStatusFilter(TenantRepository tenants, ObjectMapper objectMapper) {
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwtAuth) {
            String tenantId = jwtAuth.getToken().getClaimAsString(AdminTokenService.TENANT_CLAIM);
            if (tenantId != null && !tenantId.isBlank() && !isActive(tenantId)) {
                reject(response);
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private boolean isActive(String tenantId) {
        return tenants.findById(tenantId)
                .map(tenant -> tenant.status() == TenantStatus.ACTIVE)
                .orElse(false); // unknown tenant id on a signed token should never happen; fail closed if it does
    }

    private void reject(HttpServletResponse response) throws IOException {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "tenant is not active");
        problem.setTitle("Forbidden");
        problem.setType(URI.create("about:blank"));

        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(objectMapper.writeValueAsString(problem));
    }
}
