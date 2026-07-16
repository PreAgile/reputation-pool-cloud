package io.github.preagile.reputationpool.cloud.grpc;

import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.port.EventSink;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * An {@link EventSink} that fans each event out to several sinks — the live gRPC stream and the
 * durable audit trail side by side. The pool takes exactly one sink, deliberately: composing multiple
 * consumers is an adapter concern, solved here outside the core rather than by widening the pool.
 * Ported from the public reputation-pool server reference.
 *
 * <p>Delegates are isolated from each other: one sink throwing must not starve the ones after it, so a
 * {@link RuntimeException} is logged and swallowed per delegate. Each delegate keeps its own
 * non-blocking discipline; this class only sequences the calls on the emitting thread.
 */
public final class CompositeEventSink implements EventSink {

    private static final Logger log = LoggerFactory.getLogger(CompositeEventSink.class);

    private final List<EventSink> delegates;

    /**
     * @param delegates the sinks to fan out to, called in list order; never null or empty
     * @throws IllegalArgumentException if {@code delegates} is empty
     */
    public CompositeEventSink(List<EventSink> delegates) {
        this.delegates = List.copyOf(delegates);
        if (this.delegates.isEmpty()) {
            throw new IllegalArgumentException("delegates must not be empty");
        }
    }

    @Override
    public void emit(PoolEvent event) {
        for (EventSink delegate : delegates) {
            try {
                delegate.emit(event);
            } catch (RuntimeException e) {
                log.warn(
                        "event sink {} failed to accept an event",
                        delegate.getClass().getName(),
                        e);
            }
        }
    }
}
