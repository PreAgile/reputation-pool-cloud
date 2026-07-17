package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.PoolOverview;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.ResourceDetail;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.time.Clock;
import java.util.Locale;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The dashboard read model over the live pool state (issue #11): a KPI + per-resource overview and a
 * per-resource cell drill-down, both assembled from {@code registry.poolFor(tenant).snapshot()}.
 *
 * <p>The tenant is the server-decided one bound to the JWT ({@link AdminTenant}), never a request
 * parameter (security.md). <b>Caveat:</b> the interim {@link TenantPoolRegistry} routes every tenant
 * to one shared pool, so these reads are not yet truly tenant-scoped — they reflect the single pool
 * regardless of the bound tenant. #9b supplies real per-tenant pools; this controller already depends
 * only on the registry interface, so it becomes tenant-scoped automatically once that lands.
 */
@RestController
@RequestMapping("/api/pools")
public class PoolController {

    private final TenantPoolRegistry registry;
    private final Clock clock;

    public PoolController(TenantPoolRegistry registry, Clock clock) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @GetMapping("/resources")
    public PoolOverview overview(@AuthenticationPrincipal Jwt jwt) {
        PoolSnapshot snapshot = registry.poolFor(AdminTenant.of(jwt)).snapshot();
        return PoolViewAssembler.overview(snapshot, clock.instant());
    }

    @GetMapping("/resources/{kind}/{value}")
    public ResourceDetail detail(
            @AuthenticationPrincipal Jwt jwt, @PathVariable String kind, @PathVariable String value) {
        ResourceId resource = parseResource(kind, value);
        PoolSnapshot snapshot = registry.poolFor(AdminTenant.of(jwt)).snapshot();
        return PoolViewAssembler.detail(snapshot, resource, clock.instant())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "resource not found"));
    }

    private static ResourceId parseResource(String kind, String value) {
        try {
            return new ResourceId(ResourceKind.valueOf(kind.toUpperCase(Locale.ROOT)), value);
        } catch (IllegalArgumentException invalid) {
            // Unknown kind or blank value: a client error, not a 500.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid resource kind or value");
        }
    }
}
