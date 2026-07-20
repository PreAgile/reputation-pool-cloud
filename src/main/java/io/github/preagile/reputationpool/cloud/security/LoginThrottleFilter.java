package io.github.preagile.reputationpool.cloud.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rejects brute-force login attempts before they reach the controller (issue #28). Runs only for {@code
 * POST /api/auth/login}; everything else passes straight through. Sits inside the servlet security chain
 * ({@code addFilterBefore} in {@link SecurityConfiguration}) after the endpoint is admitted by
 * {@code permitAll} but before any authentication work — a blocked IP costs nothing downstream.
 *
 * <p><b>Decision then bookkeeping.</b> Before the chain runs, {@link LoginThrottle#checkAllowed} decides
 * whether this IP may proceed; if not, the filter answers {@code 429} with a {@code Retry-After} header
 * and a generic {@link ProblemDetail} (never revealing whether the credentials were valid) and stops.
 * If allowed, the chain runs and the <em>response status</em> tells success from failure: the login
 * controller returns {@code 200} on success and {@code 401} on bad credentials (via {@link
 * org.springframework.web.server.ResponseStatusException}), so the filter reads {@link
 * HttpServletResponse#getStatus()} afterwards — {@code 200} clears the IP's counter, {@code 401} records
 * a failure. Other statuses (e.g. a malformed body → 400) are not counted as credential failures.
 *
 * <p><b>Client IP.</b> The IP is {@link HttpServletRequest#getRemoteAddr()}. With {@code
 * server.forward-headers-strategy: framework} (application.yml) this reflects the real client behind
 * Caddy (#15) via {@code X-Forwarded-For} — but that is only safe because the trust boundary is the
 * network: port 8083 must be reachable only by the reverse proxy, never exposed directly, or a client
 * could spoof {@code X-Forwarded-For} to dodge or frame another IP.
 */
public final class LoginThrottleFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(LoginThrottleFilter.class);

    /** Counter incremented whenever the filter blocks a login — a hook for the #14/#45 alert pipeline. */
    private static final String THROTTLED_COUNTER = "auth.login.throttled";

    private static final String LOGIN_PATH = "/api/auth/login";

    private final LoginThrottle throttle;
    private final MeterRegistry meterRegistry;
    private final ObjectMapper objectMapper;

    public LoginThrottleFilter(LoginThrottle throttle, MeterRegistry meterRegistry, ObjectMapper objectMapper) {
        this.throttle = Objects.requireNonNull(throttle, "throttle must not be null");
        this.meterRegistry = Objects.requireNonNull(meterRegistry, "meterRegistry must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Only the login POST is brute-forceable; skip everything else (and skip entirely when disabled).
        return !throttle.enabled()
                || !HttpMethod.POST.matches(request.getMethod())
                || !LOGIN_PATH.equals(request.getRequestURI());
    }

    // Throttle only the original request dispatch: an internal ERROR/ASYNC re-dispatch of the same login
    // would otherwise re-read the status and double-count one attempt.
    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return true;
    }

    @Override
    protected boolean shouldNotFilterAsyncDispatch() {
        return true;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String ip = request.getRemoteAddr();

        LoginThrottle.Decision decision = throttle.checkAllowed(ip);
        if (!decision.allowed()) {
            reject(response, decision.retryAfterSeconds(), ip);
            return;
        }

        chain.doFilter(request, response);

        int status = response.getStatus();
        if (status == HttpStatus.OK.value()) {
            throttle.recordSuccess(ip);
        } else if (status == HttpStatus.UNAUTHORIZED.value()) {
            throttle.recordFailure(ip);
        }
    }

    private void reject(HttpServletResponse response, long retryAfterSeconds, String ip) throws IOException {
        meterRegistry.counter(THROTTLED_COUNTER).increment();
        // No credentials or usernames in the log — only the (already-known) source IP and the hint.
        log.warn("로그인 브루트포스 차단: ip={} retryAfterSeconds={}", ip, retryAfterSeconds);

        ProblemDetail problem =
                ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.");
        problem.setTitle("Too Many Requests");
        problem.setType(URI.create("about:blank"));

        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getWriter().write(objectMapper.writeValueAsString(problem));
    }
}
