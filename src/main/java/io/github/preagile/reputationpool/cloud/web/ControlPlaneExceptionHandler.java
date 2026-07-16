package io.github.preagile.reputationpool.cloud.web;

import java.util.Map;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Renders the control plane's deliberate {@link ResponseStatusException}s (401/404/409/400) as a small
 * JSON body carrying their curated reason. Spring Boot's default error handling omits the reason unless
 * {@code server.error.include-message=always}, which would also leak internal exception messages on
 * uncaught 500s; this advice surfaces only the messages the controllers chose to expose, leaving
 * unexpected failures to the default generic 500. The reasons here are safe by construction — no
 * secrets, no raw keys (security.md) — and existence is never disclosed (e.g. a bad login is a bare
 * "invalid credentials").
 */
@RestControllerAdvice
public class ControlPlaneExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    ProblemDetail handle(ResponseStatusException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(exception.getStatusCode());
        String reason = exception.getReason();
        if (reason != null) {
            problem.setProperties(Map.of("message", reason));
        }
        return problem;
    }
}
