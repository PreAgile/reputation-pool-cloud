package io.github.preagile.reputationpool.cloud.security;

import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import javax.sql.DataSource;

/**
 * Issues, lists, and revokes tenant API keys for the REST control plane (issue #11). It lives in the
 * {@code security} package so it can reuse {@link ApiKeyHashing} — the same one-way SHA-256 transform
 * the seeder writes and the resolver reads — which is package-private on purpose: the raw key must
 * never be compared or stored anywhere.
 *
 * <p><b>Show-once tokens.</b> {@link #issue} generates a high-entropy random token ({@code rp_} +
 * base64url of 256 random bits), returns the raw value to the caller <em>once</em>, and persists only
 * its hash plus a non-secret display prefix. There is no way to recover a raw token afterward — a
 * lost key is re-issued, not looked up — so {@link #list} can never leak key material.
 *
 * <p><b>Revocation is immediate.</b> {@link #revoke} sets {@code revoked_at}; the gRPC
 * {@link JdbcTenantResolver} already filters on {@code revoked_at IS NULL}, so a revoked key stops
 * resolving on its very next call. Plain JDBC throughout, matching the persistence adapter's idiom.
 */
public final class ApiKeyManagementService {

    /** Raw-token prefix that namespaces cloud API keys and makes an accidental leak greppable. */
    private static final String TOKEN_PREFIX = "rp_";

    /** 256 bits of entropy — brute-forcing the token (or its SHA-256) is infeasible. */
    private static final int TOKEN_ENTROPY_BYTES = 32;

    /** How much of the raw token to keep as the non-secret display prefix ("rp_" + 8 chars). */
    private static final int DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length() + 8;

    private static final String INSERT =
            "INSERT INTO api_key (key_hash, tenant_id, label, created_at, id, prefix) VALUES (?, ?, ?, ?, ?, ?)";
    private static final String SELECT_BY_TENANT =
            "SELECT id, label, prefix, created_at, revoked_at FROM api_key WHERE tenant_id = ? ORDER BY created_at";
    private static final String REVOKE =
            "UPDATE api_key SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL";

    private final DataSource dataSource;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final Base64.Encoder base64 = Base64.getUrlEncoder().withoutPadding();

    public ApiKeyManagementService(DataSource dataSource, Clock clock) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /**
     * Mints a new key for {@code tenantId}, storing only its hash and display prefix. The returned
     * {@link IssuedApiKey} is the one and only time the raw token is available.
     */
    public IssuedApiKey issue(String tenantId, String label) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        byte[] entropy = new byte[TOKEN_ENTROPY_BYTES];
        random.nextBytes(entropy);
        String rawToken = TOKEN_PREFIX + base64.encodeToString(entropy);
        String prefix = rawToken.substring(0, DISPLAY_PREFIX_LENGTH);
        UUID id = UUID.randomUUID();
        Instant createdAt = clock.instant();
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(INSERT)) {
            statement.setBytes(1, ApiKeyHashing.sha256(rawToken));
            statement.setString(2, tenantId);
            statement.setString(3, label);
            statement.setTimestamp(4, Timestamp.from(createdAt));
            statement.setObject(5, id);
            statement.setString(6, prefix);
            statement.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("api key issue failed", e);
        }
        return new IssuedApiKey(id.toString(), rawToken, label, prefix, createdAt);
    }

    /** All of the tenant's keys, oldest first — never the raw token or hash, only the masked prefix. */
    public List<ApiKeySummary> list(String tenantId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(SELECT_BY_TENANT)) {
            statement.setString(1, tenantId);
            try (ResultSet rows = statement.executeQuery()) {
                List<ApiKeySummary> keys = new ArrayList<>();
                while (rows.next()) {
                    Timestamp revokedAt = rows.getTimestamp("revoked_at");
                    keys.add(new ApiKeySummary(
                            rows.getString("id"),
                            rows.getString("label"),
                            rows.getString("prefix"),
                            rows.getTimestamp("created_at").toInstant(),
                            revokedAt == null ? null : revokedAt.toInstant()));
                }
                return keys;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("api key list failed", e);
        }
    }

    /**
     * Revokes the tenant's key by its public id. Returns {@code true} if an active key was revoked,
     * {@code false} if no active key with that id exists for the tenant (unknown, already revoked, or
     * belonging to another tenant — the caller turns that into 404 without disclosing which).
     */
    public boolean revoke(String tenantId, String keyId) {
        Objects.requireNonNull(tenantId, "tenantId must not be null");
        Objects.requireNonNull(keyId, "keyId must not be null");
        UUID id;
        try {
            id = UUID.fromString(keyId);
        } catch (IllegalArgumentException malformed) {
            return false; // a non-UUID id can match no row: not found, not a server error
        }
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(REVOKE)) {
            statement.setTimestamp(1, Timestamp.from(clock.instant()));
            statement.setObject(2, id);
            statement.setString(3, tenantId);
            return statement.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException("api key revoke failed", e);
        }
    }

    /** A freshly issued key: the raw token is present exactly here and never persisted or shown again. */
    public record IssuedApiKey(String id, String rawToken, String label, String prefix, Instant createdAt) {}

    /** A stored key as safe to list: id, label, masked display prefix, and lifecycle timestamps. */
    public record ApiKeySummary(String id, String label, String prefix, Instant createdAt, Instant revokedAt) {}
}
