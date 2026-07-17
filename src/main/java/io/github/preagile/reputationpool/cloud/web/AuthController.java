package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.security.AdminTokenService;
import io.github.preagile.reputationpool.cloud.web.dto.LoginRequest;
import io.github.preagile.reputationpool.cloud.web.dto.LoginResponse;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The one public control-plane endpoint: exchanges admin credentials for a JWT. Everything else under
 * {@code /api/**} requires the token this mints. A wrong username, a wrong password, and an
 * unconfigured console are all indistinguishable to the caller — the response is a bare 401 — so the
 * endpoint reveals nothing about why authentication failed (security.md).
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AdminTokenService tokenService;

    public AuthController(AdminTokenService tokenService) {
        this.tokenService = Objects.requireNonNull(tokenService, "tokenService must not be null");
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request) {
        return tokenService
                .issueToken(request.username(), request.password())
                .map(token -> new LoginResponse(token.token(), "Bearer", token.expiresInSeconds()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid credentials"));
    }
}
