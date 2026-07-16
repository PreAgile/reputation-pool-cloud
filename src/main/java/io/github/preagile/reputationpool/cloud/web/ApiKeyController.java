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
 * <p>The path's {@code tenantId} is validated against the tenant table before any action (404 if
 * unknown) rather than blindly trusted — a server-side check, not a request-supplied boundary. As with
 * tenant creation, v1 treats a valid admin token as a global operator (no RBAC); per-tenant scoping is
 * follow-up work.
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
            @PathVariable String tenantId, @RequestBody(required = false) CreateApiKeyRequest request) {
        requireTenant(tenantId);
        String label = request == null ? null : request.label();
        IssuedApiKey issued = apiKeys.issue(tenantId, label);
        return ResponseEntity.status(HttpStatus.CREATED).body(issued);
    }

    @GetMapping
    public List<ApiKeySummary> list(@PathVariable String tenantId) {
        requireTenant(tenantId);
        return apiKeys.list(tenantId);
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<Void> revoke(@PathVariable String tenantId, @PathVariable String keyId) {
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
