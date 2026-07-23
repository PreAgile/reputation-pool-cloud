package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService.ApiKeySummary;
import io.github.preagile.reputationpool.cloud.security.ApiKeyManagementService.IssuedApiKey;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.web.dto.CreateApiKeyRequest;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * API-key management for a tenant (issue #11): issue, list, revoke. Issuing returns the raw token
 * <em>once</em>; listing shows only masked prefixes; revoking flips {@code revoked_at}, which the gRPC
 * resolver honors on the next call.
 *
 * <p>The path's {@code tenantId} is validated against the tenant table (404 if unknown), but only after
 * {@link AdminTenant#requireScope} confirms the token is bound to that tenant (403 otherwise, issue #82)
 * — a token may manage only its own tenant's keys. The scope check runs first so a 404/403 difference
 * cannot probe whether another tenant exists (security.md non-disclosure). Broader operator RBAC across
 * tenants is follow-up work (#31).
 */
@RestController
@RequestMapping("/api/tenants/{tenantId}/api-keys")
public class ApiKeyController {

    private final ApiKeyManagementService apiKeys;
    private final TenantRepository tenants;

    public ApiKeyController(ApiKeyManagementService apiKeys, TenantRepository tenants) {
        this.apiKeys = Objects.requireNonNull(apiKeys, "apiKeys must not be null");
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
    }

    @PostMapping
    public ResponseEntity<IssuedApiKey> issue(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String tenantId,
            @RequestBody(required = false) CreateApiKeyRequest request) {
        // Scope before existence: a token may only manage keys for its own tenant, and the 403 must land
        // before requireTenant's 404 so a 404/403 difference cannot probe whether another tenant exists.
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        String label = request == null ? null : request.label();
        IssuedApiKey issued = apiKeys.issue(tenantId, label);
        return ResponseEntity.status(HttpStatus.CREATED).body(issued);
    }

    @GetMapping
    public List<ApiKeySummary> list(@AuthenticationPrincipal Jwt jwt, @PathVariable String tenantId) {
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        return apiKeys.list(tenantId);
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal Jwt jwt, @PathVariable String tenantId, @PathVariable String keyId) {
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        if (!apiKeys.revoke(tenantId, keyId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "api key not found");
        }
        return ResponseEntity.noContent().build();
    }

    private void requireTenant(String tenantId) {
        if (tenants.findById(tenantId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found");
        }
    }
}
