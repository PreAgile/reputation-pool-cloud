package io.github.preagile.reputationpool.cloud.alert;

import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.port.EventSink;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * An {@link EventSink} that turns a {@code BLOCKLISTED} state transition into an operator alert (issue
 * #45, slice A). It joins the process-wide fan-out sink beside the gRPC broadcaster and the audit trail
 * (see {@code EngineConfiguration#poolEventSink}), so it observes every pool event — but forwards only
 * {@link PoolEvent.ResourceBlocklisted} on to the {@link AlertNotifier}. Every other event type is
 * ignored (COOLING surge, lease events, recover/unblock are out of this slice's scope).
 *
 * <p><b>Honours the non-blocking {@link EventSink} contract.</b> This runs on the engine's event-emitting
 * thread, so it does no I/O of its own: it builds a small payload and hands it to the notifier, whose
 * {@code notify} is a non-blocking fire-and-forget. Alerting is opt-in and fail-safe end to end — a
 * disabled/unconfigured notifier no-ops, and the notifier never throws — so wiring this sink in
 * unconditionally is safe even when alerting is off.
 */
public final class AlertingEventSink implements EventSink {

    private static final Logger log = LoggerFactory.getLogger(AlertingEventSink.class);

    private final AlertNotifier notifier;

    public AlertingEventSink(AlertNotifier notifier) {
        this.notifier = Objects.requireNonNull(notifier, "notifier must not be null");
    }

    @Override
    public void emit(PoolEvent event) {
        if (!(event instanceof PoolEvent.ResourceBlocklisted blocklisted)) {
            return;
        }
        try {
            notifier.notify(AlertPayload.ofBlocklisted(blocklisted));
        } catch (RuntimeException e) {
            // Defence in depth: the notifier contract forbids throwing, but a broken implementation must
            // still never break the engine's event emission. (CompositeEventSink also isolates delegates.)
            log.warn("alerting sink swallowed a notifier failure for a blocklisted resource", e);
        }
    }
}
