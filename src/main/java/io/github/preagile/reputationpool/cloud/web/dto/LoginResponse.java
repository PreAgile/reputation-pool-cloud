package io.github.preagile.reputationpool.cloud.web.dto;

/**
 * Login result: the bearer token to send as {@code Authorization: Bearer <token>} and how long it is
 * valid. The token is the only credential the client keeps; there is no refresh token in v1.
 */
public record LoginResponse(String token, String tokenType, long expiresInSeconds) {}
