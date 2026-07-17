package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.PoolOverview;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.ResourceDetail;
import io.github.preagile.reputationpool.cloud.readmodel.ScoreHistoryReader;
import io.github.preagile.reputationpool.cloud.readmodel.ScoreHistoryReader.ScoreHistory;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
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

    /** Upper bound on the score-history window: 30 days, so an abusive {@code hours} cannot scan the table. */
    private static final int MAX_HISTORY_HOURS = 24 * 30;

    private final TenantPoolRegistry registry;
    private final ScoreHistoryReader scoreHistory;
    private final Clock clock;

    public PoolController(TenantPoolRegistry registry, ScoreHistoryReader scoreHistory, Clock clock) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.scoreHistory = Objects.requireNonNull(scoreHistory, "scoreHistory must not be null");
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

    /**
     * The resource's per-context reputation-score series over the last {@code hours} (default 24), for the
     * dashboard's 24h curve. The tenant is the server-decided one on the JWT; {@code hours} is clamped to
     * {@code [1, 720]} so a caller cannot request an unbounded scan.
     */
    @GetMapping("/resources/{kind}/{value}/score-history")
    public ScoreHistory scoreHistory(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String kind,
            @PathVariable String value,
            @RequestParam(defaultValue = "24") int hours) {
        ResourceId resource = parseResource(kind, value);
        int safeHours = Math.max(1, Math.min(hours, MAX_HISTORY_HOURS));
        Instant since = clock.instant().minus(Duration.ofHours(safeHours));
        return scoreHistory.read(AdminTenant.of(jwt), resource, since);
    }

    /**
     * 리소스를 수동 차단한다(운영자 개입). {@code permanent=true}면 영구 차단, 아니면 {@code seconds}(기본
     * 3600) 동안 임시 차단. 테넌트는 JWT에서 서버가 결정한다. 엔진이 {@code RESOURCE_BLOCKLISTED} 이벤트를
     * 발생시키므로 감사 타임라인·이벤트 피드에 그대로 반영된다. 자동 차단이 없는 엔진에서 운영자가 위험한
     * 리소스를 즉시 격리할 수 있는 유일한 경로다.
     */
    @PostMapping("/resources/{kind}/{value}/block")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void block(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String kind,
            @PathVariable String value,
            @RequestParam(defaultValue = "false") boolean permanent,
            @RequestParam(name = "seconds", required = false) Long seconds) {
        ResourceId resource = parseResource(kind, value);
        ResourcePool pool = registry.poolFor(AdminTenant.of(jwt));
        if (permanent) {
            pool.blockPermanently(resource);
        } else {
            long ttl = seconds != null && seconds > 0 ? seconds : 3600;
            pool.block(resource, Duration.ofSeconds(ttl));
        }
    }

    /** 리소스의 차단을 해제한다(수동). 엔진이 {@code RESOURCE_UNBLOCKED} 이벤트를 발생시킨다. */
    @DeleteMapping("/resources/{kind}/{value}/block")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unblock(@AuthenticationPrincipal Jwt jwt, @PathVariable String kind, @PathVariable String value) {
        registry.poolFor(AdminTenant.of(jwt)).unblock(parseResource(kind, value));
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
