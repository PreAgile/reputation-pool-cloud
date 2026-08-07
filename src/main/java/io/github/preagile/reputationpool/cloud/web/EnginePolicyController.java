package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.policy.EnginePolicy;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyCeiling;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyConflictException;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyRepository;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicyRevision;
import io.github.preagile.reputationpool.cloud.policy.StoredEnginePolicySource;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.web.dto.SetEnginePolicyRequest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Per-tenant engine policy management (issue #179): read the policy a tenant's pools are built from,
 * replace it, and read the trail of who replaced it with what.
 *
 * <p><b>Scope before existence.</b> Like {@link ApiKeyController}, every handler runs
 * {@link AdminTenant#requireScope} before touching the tenant table, so aiming at another tenant is a
 * 403 whether or not that tenant exists — a 404/403 difference would otherwise probe the tenant list
 * (issue #82, security.md non-disclosure). {@code changedBy} likewise comes off the validated token's
 * subject, never off the request body.
 *
 * <p><b>Why the write is validated here rather than at the pool.</b> Every range in {@link EnginePolicy}
 * is already enforced by the upstream engine constructors — but those run when a pool is <em>built</em>,
 * and pools are built lazily on a tenant's first reference. Without this check a bad policy would be
 * stored successfully and surface much later as a 500 on that tenant's first gRPC call. Rejecting it at
 * write time turns that into a 400 on the request that actually caused it. The per-instance
 * {@link EnginePolicyCeiling} is applied at the same point and for the same reason.
 *
 * <p><b>A write takes effect on the tenant's next pool build.</b> {@code ResourcePool} holds its engine
 * and lease TTL in {@code final} fields, so a live pool cannot be re-tuned; rebuilding it on every
 * change would reset the tenant's reputation state and drop its in-flight leases (see
 * {@code PerTenantPoolRegistry}). The response says so explicitly rather than letting a console imply
 * the change is already live.
 */
@RestController
@RequestMapping("/api/tenants/{tenantId}/engine-policy")
public class EnginePolicyController {

    /** How many revisions the history endpoint returns; newest first. */
    private static final int HISTORY_LIMIT = 100;

    private final EnginePolicyRepository policies;
    private final StoredEnginePolicySource policySource;
    private final EnginePolicyCeiling ceiling;
    private final TenantRepository tenants;
    private final Clock clock;

    public EnginePolicyController(
            EnginePolicyRepository policies,
            StoredEnginePolicySource policySource,
            EnginePolicyCeiling ceiling,
            TenantRepository tenants,
            Clock clock) {
        this.policies = Objects.requireNonNull(policies, "policies must not be null");
        this.policySource = Objects.requireNonNull(policySource, "policySource must not be null");
        this.ceiling = Objects.requireNonNull(ceiling, "ceiling must not be null");
        this.tenants = Objects.requireNonNull(tenants, "tenants must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /**
     * The policy this tenant's pools are actually built from, plus the ceiling it has to fit under. A
     * tenant with nothing stored reports the instance defaults with {@code source: "instance-default"} —
     * which is also what makes the all-or-nothing write usable: a console reads this, edits a field, and
     * writes the whole thing back, so completeness never becomes the caller's paperwork.
     */
    @GetMapping
    public EffectivePolicyView get(@AuthenticationPrincipal Jwt jwt, @PathVariable String tenantId) {
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        Optional<EnginePolicyRevision> stored = policies.findCurrent(tenantId);
        return new EffectivePolicyView(
                stored.isPresent() ? "tenant" : "instance-default",
                PolicyView.of(stored.map(EnginePolicyRevision::policy).orElseGet(policySource::instanceDefault)),
                stored.map(RevisionView::of).orElse(null),
                CeilingView.of(ceiling));
    }

    /**
     * Replaces the tenant's policy with a complete new one, appended as the next revision. Partial
     * bodies are refused rather than merged: a policy is complete or absent.
     */
    @PutMapping
    public WriteResultView put(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String tenantId,
            @RequestBody(required = false) SetEnginePolicyRequest request) {
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        EnginePolicy policy = toPolicy(request);
        try {
            ceiling.check(policy);
        } catch (IllegalArgumentException e) {
            throw badRequest(e.getMessage());
        }
        EnginePolicyRevision saved;
        try {
            saved = policies.append(tenantId, policy, AdminTenant.subjectOf(jwt), clock.instant());
        } catch (EnginePolicyConflictException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "engine policy was concurrently changed, retry");
        }
        return new WriteResultView(RevisionView.of(saved), PolicyView.of(saved.policy()), true);
    }

    /**
     * The tenant's policy changes, newest first: who changed it, when, and to what. Consecutive
     * revisions are the before/after pair — the table is append-only, so nothing is overwritten.
     */
    @GetMapping("/history")
    public List<RevisionEntryView> history(@AuthenticationPrincipal Jwt jwt, @PathVariable String tenantId) {
        AdminTenant.requireScope(jwt, tenantId);
        requireTenant(tenantId);
        return policies.history(tenantId, HISTORY_LIMIT).stream()
                .map(revision -> new RevisionEntryView(RevisionView.of(revision), PolicyView.of(revision.policy())))
                .toList();
    }

    /**
     * Turns a request body into a policy, or refuses it with a 400 naming the offending field. Three
     * layers of refusal land here: a missing field, an unparseable duration, and a value outside the
     * range the upstream engine accepts ({@link EnginePolicy}'s constructor).
     */
    private static EnginePolicy toPolicy(SetEnginePolicyRequest request) {
        if (request == null) {
            throw badRequest("engine policy body is required");
        }
        int windowSize = required(request.windowSize(), "windowSize");
        int coolAfter = required(request.coolAfter(), "coolAfter");
        int recoverAfter = required(request.recoverAfter(), "recoverAfter");
        int cooldownMaxExponent = required(request.cooldownMaxExponent(), "cooldownMaxExponent");
        double explorationFloor = required(request.explorationFloor(), "explorationFloor");
        String rawLeaseTtl = request.leaseTtl();
        if (rawLeaseTtl == null || rawLeaseTtl.isBlank()) {
            throw badRequest("leaseTtl is required");
        }
        Duration leaseTtl;
        try {
            leaseTtl = Duration.parse(rawLeaseTtl.trim());
        } catch (DateTimeParseException e) {
            throw badRequest("leaseTtl must be an ISO-8601 duration (e.g. PT30S)");
        }
        try {
            return new EnginePolicy(
                    windowSize, coolAfter, recoverAfter, leaseTtl, cooldownMaxExponent, explorationFloor);
        } catch (IllegalArgumentException e) {
            throw badRequest(e.getMessage());
        }
    }

    private static <T> T required(T value, String field) {
        if (value == null) {
            // All-or-nothing: a policy is complete or absent, so a missing field is not "keep the old
            // value" — saying which one is missing is the whole point of the boxed request type.
            throw badRequest(field + " is required (an engine policy is set as a whole, not field by field)");
        }
        return value;
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    private void requireTenant(String tenantId) {
        if (tenants.findById(tenantId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found");
        }
    }

    /** A policy on the wire; {@code leaseTtl} is ISO-8601, matching what a write accepts. */
    public record PolicyView(
            int windowSize,
            int coolAfter,
            int recoverAfter,
            String leaseTtl,
            int cooldownMaxExponent,
            double explorationFloor) {

        static PolicyView of(EnginePolicy policy) {
            return new PolicyView(
                    policy.windowSize(),
                    policy.coolAfter(),
                    policy.recoverAfter(),
                    policy.leaseTtl().toString(),
                    policy.cooldownMaxExponent(),
                    policy.explorationFloor());
        }
    }

    /** Who wrote a revision and when. */
    public record RevisionView(int revision, String changedBy, Instant changedAt) {

        static RevisionView of(EnginePolicyRevision revision) {
            return new RevisionView(revision.revision(), revision.changedBy(), revision.changedAt());
        }
    }

    /** This instance's upper bound, returned with the policy so a console can validate before writing. */
    public record CeilingView(
            int maxWindowSize,
            int maxCoolAfter,
            int maxRecoverAfter,
            String maxLeaseTtl,
            int maxCooldownMaxExponent,
            double maxExplorationFloor) {

        static CeilingView of(EnginePolicyCeiling ceiling) {
            return new CeilingView(
                    ceiling.maxWindowSize(),
                    ceiling.maxCoolAfter(),
                    ceiling.maxRecoverAfter(),
                    ceiling.maxLeaseTtl().toString(),
                    ceiling.maxCooldownMaxExponent(),
                    ceiling.maxExplorationFloor());
        }
    }

    /**
     * @param source {@code "tenant"} if a policy is stored for this tenant, {@code "instance-default"} if
     *     it is running the instance-wide defaults
     * @param revision null when {@code source} is {@code "instance-default"}
     */
    public record EffectivePolicyView(String source, PolicyView policy, RevisionView revision, CeilingView ceiling) {}

    /**
     * @param appliesOnNextPoolBuild always true, and stated rather than implied: the tenant's live pool
     *     keeps running the policy it was built with until it is rebuilt (eviction or restart)
     */
    public record WriteResultView(RevisionView revision, PolicyView policy, boolean appliesOnNextPoolBuild) {}

    /** One entry of the change history. */
    public record RevisionEntryView(RevisionView revision, PolicyView policy) {}
}
