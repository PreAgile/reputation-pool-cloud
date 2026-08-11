package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.readmodel.ContextRollupReader;
import io.github.preagile.reputationpool.cloud.readmodel.ContextRollupReader.ContextHistory;
import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler;
import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler.ContextDetail;
import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler.ContextOverview;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The dashboard's <b>context axis</b>: which contexts the tenant's pool is serving, how each one is
 * doing, and how each has trended. {@link PoolController} answers the same questions per resource; this
 * one answers them per context, which is the entry point an operator reaches for first when a pool spans
 * several call sites (platforms, endpoints, jobs).
 *
 * <p>Two data sources, deliberately different:
 *
 * <ul>
 *   <li><b>Current state</b> ({@code /api/contexts}, {@code /api/contexts/{context}/resources}) comes from
 *       the live snapshot, so it is exact and needs no table scan.
 *   <li><b>History</b> ({@code /api/contexts/score-history}) comes from the hourly rollup rather than the
 *       raw samples, which is what lets the window reach 90 days — see {@link ContextRollupReader}.
 * </ul>
 *
 * <p>The tenant is the server-decided one bound to the JWT ({@link AdminTenant}), never a request
 * parameter (security.md).
 */
@RestController
@RequestMapping("/api/contexts")
public class ContextController {

    /** Upper bound on the context-history window: 90 days, matching the rollup's default retention. */
    private static final int MAX_HISTORY_HOURS = 24 * 90;

    private final TenantPoolRegistry registry;
    private final ContextRollupReader rollup;
    private final Clock clock;

    public ContextController(TenantPoolRegistry registry, ContextRollupReader rollup, Clock clock) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.rollup = Objects.requireNonNull(rollup, "rollup must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /** Every context the tenant's pool holds cells for, each with its state breakdown and last activity. */
    @GetMapping
    public ContextOverview overview(@AuthenticationPrincipal Jwt jwt) {
        PoolSnapshot snapshot = registry.poolFor(AdminTenant.of(jwt)).snapshot();
        return ContextViewAssembler.overview(snapshot, clock.instant());
    }

    /**
     * Every context's hourly score curve over the last {@code hours} (default 24). {@code hours} is clamped
     * to {@code [1, 2160]} so a caller cannot request an unbounded scan.
     */
    @GetMapping("/score-history")
    public ContextHistory scoreHistory(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "24") int hours) {
        int safeHours = Math.max(1, Math.min(hours, MAX_HISTORY_HOURS));
        Instant since = clock.instant().minus(Duration.ofHours(safeHours));
        return rollup.read(AdminTenant.of(jwt), since);
    }

    /** The resources holding a cell in {@code context}, worst first. 404 when no cell carries it. */
    @GetMapping("/{context}/resources")
    public ContextDetail resources(@AuthenticationPrincipal Jwt jwt, @PathVariable String context) {
        PoolSnapshot snapshot = registry.poolFor(AdminTenant.of(jwt)).snapshot();
        return ContextViewAssembler.detail(snapshot, context, clock.instant())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "context not found"));
    }
}
