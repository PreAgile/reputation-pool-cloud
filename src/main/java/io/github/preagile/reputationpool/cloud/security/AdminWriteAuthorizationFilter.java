package io.github.preagile.reputationpool.cloud.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The one place a read-only admin token is stopped from changing anything (issue #31). Everything the
 * dashboard does to hide a button is cosmetics; this filter is the authority.
 *
 * <p><b>Why a filter and not per-controller checks.</b> The control plane's mutating surface is spread
 * over three controllers (block/unblock, tenant create/suspend/reactivate/delete, API-key issue/revoke)
 * and grows with every feature. A per-endpoint check is a list that has to be kept in sync by hand, and
 * the failure mode of forgetting one is a silent write hole. Deciding by <em>HTTP method</em> in one
 * filter inverts that: a newly added endpoint is guarded the moment it exists, and a mistake in the
 * other direction (a safe endpoint accidentally refused) is loud and harmless.
 *
 * <p><b>What counts as a write.</b> Everything that is not one of the safe methods RFC 9110 defines as
 * non-mutating ({@code GET}, {@code HEAD}, {@code OPTIONS}, {@code TRACE}). An unrecognised method is
 * therefore a write and needs authority — fail closed, so a future {@code PUT}/{@code PATCH} is covered
 * before anyone remembers to add it here.
 *
 * <p><b>Where the role comes from.</b> Only the validated JWT: this runs after
 * {@link BearerTokenAuthenticationFilter} (see {@link SecurityConfiguration}), so the token's signature
 * and expiry are already checked and {@link SecurityContextHolder} carries the resulting
 * {@link JwtAuthenticationToken}. A missing, blank or unrecognised {@code role} claim yields no role and
 * the write is refused (security.md fail closed) — notably, a token minted before this feature shipped
 * keeps working for reads and loses writes until its holder logs in again, which is the safe direction.
 *
 * <p><b>Unauthenticated requests are left alone</b> so this filter never becomes a second, weaker
 * authentication gate: {@code POST /api/auth/login} is a public write by design, and every other
 * unauthenticated request is already rejected with 401 by the authorization rules further down the
 * chain. This filter only ever <em>subtracts</em> authority from an authenticated caller.
 *
 * <p><b>Scope.</b> Servlet (REST control plane) only. The gRPC data plane authenticates with per-tenant
 * API keys and has no notion of an admin console role; it is untouched, exactly as it is by the rest of
 * the servlet chain.
 */
public final class AdminWriteAuthorizationFilter extends OncePerRequestFilter {

    /** RFC 9110 safe methods — these do not change server state, so any authenticated role may issue them. */
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final ObjectMapper objectMapper;

    public AdminWriteAuthorizationFilter(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (isSafe(request.getMethod()) || !writeRefused()) {
            chain.doFilter(request, response);
            return;
        }
        reject(response);
    }

    private static boolean isSafe(String method) {
        return method != null && SAFE_METHODS.contains(method.toUpperCase(Locale.ROOT));
    }

    /**
     * Whether the current caller is an authenticated admin that may <em>not</em> write. Anonymous callers
     * are not refused here (the authorization rules handle them); an authenticated one must present a
     * role claim that resolves to a role with write authority.
     */
    private static boolean writeRefused() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuth)) {
            return false;
        }
        return AdminRole.fromClaim(jwtAuth.getToken().getClaimAsString(AdminTokenService.ROLE_CLAIM))
                .filter(AdminRole::canWrite)
                .isEmpty();
    }

    /**
     * A generic 403, rendered the same way {@link TenantStatusFilter} renders its own — a filter runs
     * before {@code @RestControllerAdvice}, so the ProblemDetail body is written here rather than thrown.
     * The detail names the caller's own (already known) authority, which discloses nothing.
     */
    private void reject(HttpServletResponse response) throws IOException {
        ProblemDetail problem =
                ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "read-only token cannot modify anything");
        problem.setTitle("Forbidden");
        problem.setType(URI.create("about:blank"));

        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(objectMapper.writeValueAsString(problem));
    }
}
