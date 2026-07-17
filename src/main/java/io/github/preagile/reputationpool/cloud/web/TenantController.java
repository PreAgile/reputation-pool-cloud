package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.web.dto.CreateTenantRequest;
import java.net.URI;
import java.sql.SQLException;
import java.time.Clock;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tenant management (issue #11). Creating a tenant both persists it (shared {@link TenantRepository})
 * and onboards it into the {@link TenantPoolRegistry} — the seam that makes the new tenant's pool
 * available to the data plane and the read model (a no-op under the interim single-pool registry;
 * real per-tenant pools arrive with #9b).
 *
 * <p>v1 has no RBAC: a valid admin token authorizes tenant management globally. That is a deliberate
 * v1 scope, not a tenant-boundary hole — the tenant-<em>scoped</em> dashboard reads use the token's
 * bound tenant (see {@link AdminTenant}), while tenant creation is an operator action across tenants.
 */
@RestController
@RequestMapping("/api/tenants")
public class TenantController {

    private static final String UNIQUE_VIOLATION = "23505";

    private final TenantRepository tenants;
    private final TenantPoolRegistry registry;
    private final Clock clock;

    public TenantController(TenantRepository tenants, TenantPoolRegistry registry, Clock clock) {
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @PostMapping
    public ResponseEntity<Tenant> create(@RequestBody CreateTenantRequest request) {
        String id = request.id() == null ? "" : request.id().trim();
        if (id.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant id must not be blank");
        }
        // Onboard before the existence check so the operation self-heals. If a prior create persisted the
        // row but its onboard threw, the tenant is orphaned (durable but absent from the registry); a plain
        // "exists? -> 409" would short-circuit and never re-onboard it. Running the idempotent onboard first
        // re-onboards that orphan on retry (then the 409 below is correct — the row really does exist), which
        // is what makes "retry after a partial failure is safe" actually true. For a brand-new id it is a
        // cheap idempotent no-op, and the create below still guards the durable row.
        registry.onboard(id);
        if (tenants.findById(id).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant already exists");
        }
        String name = request.name() == null || request.name().isBlank() ? id : request.name();
        Tenant tenant = new Tenant(id, name, "active", clock.instant());
        try {
            tenants.create(tenant);
        } catch (RuntimeException e) {
            if (isUniqueViolation(e)) {
                // Lost a create race with a concurrent request for the same id.
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant already exists");
            }
            throw e;
        }
        return ResponseEntity.created(URI.create("/api/tenants/" + id)).body(tenant);
    }

    @GetMapping
    public List<Tenant> list() {
        return tenants.findAll();
    }

    @GetMapping("/{id}")
    public Tenant get(@PathVariable String id) {
        return tenants.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found"));
    }

    /** Whether the failure (or any cause) is a PostgreSQL unique-constraint violation (SQLState 23505). */
    private static boolean isUniqueViolation(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && UNIQUE_VIOLATION.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }
}
