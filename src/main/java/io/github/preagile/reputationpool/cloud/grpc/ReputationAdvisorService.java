package io.github.preagile.reputationpool.cloud.grpc;

import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import net.devh.boot.grpc.server.service.GrpcService;

/**
 * The Spring-registered gRPC service: a thin {@link GrpcService} adapter over the shared handler in the
 * published {@code reputation-pool-grpc} module. All six RPC handlers — decode, one pool call, encode —
 * live in the base class; cloud supplies only the framework registration and, for multi-tenancy, the
 * per-call pool routing.
 *
 * <p><b>Per-tenant routing (#9b, #29).</b> Instead of a single injected pool, cloud overrides the base's
 * {@code pool()} hook to resolve the pool for the tenant the auth interceptor put on the gRPC context
 * ({@link TenantContext#TENANT_ID}), and the {@code subscriptionPoolId()} hook so a {@code SubscribeEvents}
 * stream is scoped to that same tenant — now that emits fan out through {@code broadcaster.forPool(tenantId)}
 * (#29), a subscriber receives only its own tenant's events. Every decode/encode/error path in the base is
 * reused unchanged; the only cloud-specific behavior is which tenant a call acts on and which tenant's
 * stream a subscription joins.
 *
 * <p><b>Shared-JVM global resource budget (#84).</b> Every tenant's pool lives in this one process
 * ({@link io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry}), so an unbounded tenant
 * can grow registered resources/reputation cells until the shared heap OOMs every tenant at once. {@code
 * register()} and {@code report()} are overridden to check a process-wide {@link GlobalResourceBudget}
 * before delegating — the two RPCs that can grow the pool's durable state (verified against the 0.5.0
 * {@code core.pool.ResourcePool} source: {@code register()}'s {@code registered.add(...)} and only
 * {@code report()}'s {@code cells.compute(...)} ever add a new map entry; {@code acquire()} only ever
 * builds a transient, never-persisted {@code ReputationCell.fresh(...)} for scoring and is therefore left
 * untouched — it cannot grow anything for this budget to guard).
 *
 * <p>Both overrides use the same shape: decode just enough of the request to check whether the target
 * resource/cell is <em>already present</em> in this call's own tenant pool ({@link ResourcePool#snapshot()}).
 * An already-known resource/cell is not new — no budget check, straight to {@code super}. A genuinely new
 * one must first fit under the global budget ({@link GlobalResourceBudget#tryReserveResource()} /
 * {@link GlobalResourceBudget#tryReserveCell()}); if it does not, the call is refused with {@code
 * RESOURCE_EXHAUSTED} and {@code super} (hence core) is never called — fail-safe, not fail-closed: normal
 * traffic that only touches known state, or fits the budget, always passes.
 *
 * <p>This is a deliberately global — not per-tenant — budget: see {@link GlobalResourceBudget}'s javadoc
 * for why a single running total lets one tenant use 100% of it alone while several tenants share it
 * dynamically, with no per-tenant quota ever computed.
 *
 * <p><b>Per-context success rate (#189).</b> {@code report()} is also where every outcome is counted into
 * {@link OutcomeRecorder}. It has to be here and nowhere else: the engine's score cannot be inverted into
 * a ratio (successes and each failure kind move it by different amounts, and it clamps), and the audit
 * trail only records <em>transitions</em> — an ordinary success, and a failure that did not trip a
 * cooldown, leave no event at all. This override is the one place in the system where every single report
 * is visible together with its {@code Outcome}. Counting is an in-memory {@link java.util.concurrent.atomic.LongAdder}
 * increment, so it adds no I/O to the hottest RPC cloud serves; {@code OutcomeRollup} does the writing.
 */
@GrpcService
public class ReputationAdvisorService extends io.github.preagile.reputationpool.grpc.ReputationAdvisorService {

    private final TenantPoolRegistry registry;
    private final GlobalResourceBudget budget;
    private final OutcomeRecorder outcomes;
    private final Clock clock;

    public ReputationAdvisorService(
            TenantPoolRegistry registry,
            EventBroadcaster broadcaster,
            GlobalResourceBudget budget,
            OutcomeRecorder outcomes,
            Clock clock) {
        super(broadcaster);
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.budget = Objects.requireNonNull(budget, "budget must not be null");
        this.outcomes = Objects.requireNonNull(outcomes, "outcomes must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /**
     * Routes the call to the authenticated tenant's pool. The auth interceptor admits a call only after
     * resolving its API key to a tenant, so a served call always carries a tenant; a missing one is a
     * wiring fault, surfaced as a runtime error (the base maps it to {@code INTERNAL}) rather than
     * silently acting on some other tenant's pool.
     */
    @Override
    protected ResourcePool pool() {
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalStateException("no authenticated tenant on the gRPC context");
        }
        return registry.poolFor(tenantId);
    }

    /**
     * Scopes a {@code SubscribeEvents} stream to the authenticated tenant's pool, so the base subscribes
     * the observer under that tenant and it receives only that tenant's events (paired with the emit-side
     * {@code broadcaster.forPool(tenantId)} wiring, #29). Same guard as {@link #pool()}: a served call
     * always carries a tenant, so a missing one is a wiring fault surfaced as a runtime error rather than
     * silently joining some other tenant's — or the default — stream.
     */
    @Override
    protected String subscriptionPoolId() {
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalStateException("no authenticated tenant on the gRPC context");
        }
        return tenantId;
    }

    /**
     * Global-budget gate on resource registration (#84). If {@code request}'s resource is not already in
     * this call's tenant pool's {@link ResourcePool#snapshot()}, registering it would grow the shared
     * JVM's total registered-resource count, so it must first fit under {@link
     * GlobalResourceBudget#tryReserveResource()}; if it does not, the call is refused with {@code
     * RESOURCE_EXHAUSTED} and {@code super.register} (hence core) is never reached. Re-registering an
     * already-known resource is a no-op for core's {@code registered} set, so it is never budget-checked.
     *
     * <p>Decoding just enough of the request to build the domain {@code ResourceId} for this presence
     * check duplicates a few lines of the base module's package-private {@code ProtoMapping} (which is
     * not visible across packages); on any decode failure this falls back to {@code super.register}
     * unchecked so the base's own decode error path (mapped to {@code INVALID_ARGUMENT}) still applies —
     * a malformed request never reaches core regardless, so skipping the budget check for it is harmless.
     */
    @Override
    public void register(RegisterRequest request, StreamObserver<RegisterResponse> observer) {
        Optional<ResourceId> resource = tryDecodeResource(request.getResource());
        if (resource.isPresent()) {
            boolean alreadyRegistered = pool().snapshot().registered().contains(resource.get());
            if (!alreadyRegistered && !budget.tryReserveResource()) {
                observer.onError(Status.RESOURCE_EXHAUSTED
                        .withDescription("global resource budget exhausted (shared across every tenant)")
                        .asRuntimeException());
                return;
            }
        }
        super.register(request, observer);
    }

    /**
     * Global-budget gate on reporting (#84). Reputation cells are keyed by {@code resource × context}
     * ({@link CellKey}) and — verified against the 0.5.0 {@code core.pool.ResourcePool} source — the
     * <em>only</em> place a new entry is ever added to the pool's {@code cells} map is inside {@code
     * report()}'s {@code cells.compute(...)}; {@code acquire()} never persists the transient cell it
     * builds for scoring. So this, not {@code acquire()}, is the correct seam for the cell budget: if
     * {@code request}'s {@code CellKey} is not already in this tenant pool's {@link
     * ResourcePool#snapshot()}, this report would create a brand new cell, so it must first fit under
     * {@link GlobalResourceBudget#tryReserveCell()}; otherwise it is refused with {@code
     * RESOURCE_EXHAUSTED} and {@code super.report} (hence core) is never reached. Reporting on an
     * already-known cell is never budget-checked. Same decode fallback as {@link #register} for the same
     * reason.
     *
     * <p><b>Outcome counting (#189)</b> happens after the budget gate and before delegating, and only when
     * the resource, the context <em>and</em> the outcome all decode. That placement is the definition of
     * what the success rate counts: a report refused by the budget returned above and never happened, and
     * a malformed one is rejected by the base's decode path without ever reaching core — neither belongs
     * in a ratio describing the tenant's traffic. Everything that gets past this line does reach the
     * engine.
     */
    @Override
    public void report(ReportRequest request, StreamObserver<ReportResponse> observer) {
        Optional<ResourceId> resource = tryDecodeResource(request.getResource());
        Optional<Context> context = tryDecodeContext(request.getContext());
        if (resource.isPresent() && context.isPresent()) {
            CellKey key = new CellKey(resource.get(), context.get());
            boolean cellExists = pool().snapshot().cells().containsKey(key);
            if (!cellExists && !budget.tryReserveCell()) {
                observer.onError(Status.RESOURCE_EXHAUSTED
                        .withDescription("global cell budget exhausted (shared across every tenant)")
                        .asRuntimeException());
                return;
            }
            countOutcome(resource.get(), context.get(), request.getOutcome());
        }
        super.report(request, observer);
    }

    /**
     * Counts one report into the tenant's hourly bucket. The tenant comes from the gRPC context (the
     * auth interceptor's, never the request), and the hour is stamped <em>now</em> rather than at flush
     * time so a report at 10:59 lands in the 10:00 bucket even if the flush runs at 11:00.
     *
     * <p>An outcome whose kind is not set, or a failure whose type is {@code UNSPECIFIED}/unrecognized,
     * is skipped: the base's own decode rejects it with {@code INVALID_ARGUMENT}, so it never becomes a
     * reputation observation and must not become a counted one either.
     */
    private void countOutcome(ResourceId resource, Context context, AdvisorProto.Outcome outcome) {
        String tenantId = TenantContext.TENANT_ID.get();
        if (tenantId == null || tenantId.isBlank()) {
            return; // pool() above would already have thrown; kept total so counting never fails a call
        }
        Instant bucketHour = clock.instant().truncatedTo(ChronoUnit.HOURS);
        switch (outcome.getKindCase()) {
            case SUCCESS -> outcomes.recordSuccess(tenantId, context.value(), resource.kind(), bucketHour);
            case FAILURE -> {
                FailureType type = tryDecodeFailureType(outcome.getFailure().getType());
                if (type != null) {
                    outcomes.recordFailure(tenantId, context.value(), resource.kind(), bucketHour, type);
                }
            }
            case KIND_NOT_SET -> {
                /* rejected by the base's decode; not a reputation observation, so not counted */
            }
        }
    }

    /** Wire decode of the failure classification; null when the caller sent no usable type. */
    private static FailureType tryDecodeFailureType(AdvisorProto.FailureType type) {
        return switch (type) {
            case CONNECTION_RESET -> FailureType.CONNECTION_RESET;
            case TLS_HANDSHAKE -> FailureType.TLS_HANDSHAKE;
            case TIMEOUT -> FailureType.TIMEOUT;
            case BLOCKED -> FailureType.BLOCKED;
            case SLOW -> FailureType.SLOW;
            case FAILURE_TYPE_UNSPECIFIED, UNRECOGNIZED -> null;
        };
    }

    /** Best-effort wire decode of just the resource id, for the presence check above; empty on malformed input. */
    private static Optional<ResourceId> tryDecodeResource(AdvisorProto.ResourceId proto) {
        try {
            return Optional.of(new ResourceId(toDomain(proto.getKind()), proto.getValue()));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    /** Best-effort wire decode of just the context, for the presence check above; empty on malformed input. */
    private static Optional<Context> tryDecodeContext(AdvisorProto.Context proto) {
        try {
            return Optional.of(new Context(proto.getValue()));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static ResourceKind toDomain(AdvisorProto.ResourceKind kind) {
        return switch (kind) {
            case PROXY -> ResourceKind.PROXY;
            case ACCOUNT -> ResourceKind.ACCOUNT;
            case SESSION -> ResourceKind.SESSION;
            case RESOURCE_KIND_UNSPECIFIED, UNRECOGNIZED ->
                throw new IllegalArgumentException("resource kind is unspecified");
        };
    }
}
