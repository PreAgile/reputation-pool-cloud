package io.github.preagile.reputationpool.cloud.web.dto;

/**
 * Login result: the bearer token to send as {@code Authorization: Bearer <token>}, how long it is valid,
 * and the scope it was minted with. The token is the only credential the client keeps; there is no
 * refresh token in v1.
 *
 * <p>{@code scope} is {@code admin} or {@code viewer}. It is echoed so the dashboard can render a
 * read-only session honestly instead of offering controls that will 403. It is a UI hint only —
 * authorization is enforced on every request by the filter chain, never by what the client was told.
 */
public record LoginResponse(String token, String tokenType, long expiresInSeconds, String scope) {}
