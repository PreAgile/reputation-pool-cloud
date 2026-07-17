package io.github.preagile.reputationpool.cloud.metering;

import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.port.EventSink;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Objects;

/**
 * A per-tenant {@link EventSink} that meters granted leases (issue #10). One instance is bound to one
 * {@code tenantId} at construction — that is how a lease is attributed to a tenant even though
 * {@link PoolEvent} carries no tenant field: {@link io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry}
 * builds a fresh sink per tenant pool, so the tenant is known from the wiring, not the event. This
 * sidesteps the deferred per-tenant event/audit work (#29).
 *
 * <p>Only {@link PoolEvent.ResourceLeased} is counted — it is emitted exactly on a successful
 * {@code acquire} (a granted lease), and not on {@code renew}, so there is no double count. Every other
 * event type is ignored. The lease is bucketed by its own event timestamp in UTC. Recording is a
 * non-blocking counter bump, honoring the {@code EventSink} "non-blocking" contract.
 */
public final class TenantMeteringSink implements EventSink {

    private final String tenantId;
    private final MeterRecorder recorder;

    public TenantMeteringSink(String tenantId, MeterRecorder recorder) {
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId must not be null");
        this.recorder = Objects.requireNonNull(recorder, "recorder must not be null");
    }

    @Override
    public void emit(PoolEvent event) {
        if (event instanceof PoolEvent.ResourceLeased leased) {
            recorder.recordLease(tenantId, LocalDate.ofInstant(leased.at(), ZoneOffset.UTC));
        }
    }
}
