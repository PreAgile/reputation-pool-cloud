package io.github.preagile.reputationpool.cloud.metrics;

import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;

/**
 * An {@link EventSink} that turns pool state transitions into Micrometer counters (issue #45, metric
 * consumption). Like {@code AlertingEventSink} it joins the process-wide fan-out sink beside the gRPC
 * broadcaster and the audit trail (see {@code EngineConfiguration#poolEventSink}), so it observes every
 * pool event — but instead of alerting it just increments a counter per event type, which
 * {@code micrometer-registry-prometheus} exposes at {@code /actuator/prometheus}.
 *
 * <p><b>Honours the non-blocking {@link EventSink} contract.</b> This runs on the engine's event-emitting
 * thread, so it does no I/O: incrementing a Micrometer {@link Counter} is a lock-free in-memory add. The
 * four tag-free counters are pre-registered in the constructor so they appear at {@code 0} in a scrape
 * before any event fires (a Prometheus counter should exist from the start, not blink into being).
 *
 * <p><b>First slice: process-wide counts, no tenant label.</b> The shared fan-out sink is tenant-agnostic
 * (the {@link PoolEvent}s carry no tenant), so these counts are aggregated across tenants. Per-tenant
 * labelling would mean wiring a tenant-bound sink in {@code PerTenantPoolRegistry} (like
 * {@code TenantMeteringSink}) and is a deliberate follow-up — kept out here to hold cardinality down and
 * the slice small. {@code LeaseReleased} is intentionally not counted in this slice.
 */
public final class MetricsEventSink implements EventSink {

    static final String LEASE_GRANTED = "reputation.lease.granted";
    static final String BLOCKLISTED = "reputation.resource.blocklisted";
    static final String UNBLOCKED = "reputation.resource.unblocked";
    static final String COOLED = "reputation.resource.cooled";
    static final String RECOVERED = "reputation.resource.recovered";

    private final MeterRegistry registry;
    private final Counter leaseGranted;
    private final Counter blocklisted;
    private final Counter unblocked;
    private final Counter recovered;

    public MetricsEventSink(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        // Pre-register the tag-free counters so they are visible (at 0) from the first scrape. The cooled
        // counter carries a low-cardinality `cause` tag, so it is resolved per-event instead.
        this.leaseGranted = registry.counter(LEASE_GRANTED);
        this.blocklisted = registry.counter(BLOCKLISTED);
        this.unblocked = registry.counter(UNBLOCKED);
        this.recovered = registry.counter(RECOVERED);
    }

    @Override
    public void emit(PoolEvent event) {
        // Non-blocking: only counter increments (a Micrometer lookup is a concurrent-map get). No I/O, so
        // the engine's emitting thread is never held. Unknown/uncounted events fall through untouched.
        if (event instanceof PoolEvent.ResourceLeased) {
            leaseGranted.increment();
        } else if (event instanceof PoolEvent.ResourceBlocklisted) {
            blocklisted.increment();
        } else if (event instanceof PoolEvent.ResourceUnblocked) {
            unblocked.increment();
        } else if (event instanceof PoolEvent.ResourceRecovered) {
            recovered.increment();
        } else if (event instanceof PoolEvent.ResourceCooled cooled) {
            // `cause` is a bounded enum (FailureType), so it is safe as a tag — it never explodes the
            // series count the way a resource value would.
            registry.counter(COOLED, "cause", cooled.cause().name()).increment();
        }
    }
}
