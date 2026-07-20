package io.github.preagile.reputationpool.cloud.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The alerting sink must forward only {@code BLOCKLISTED} transitions to the notifier, build a faithful
 * payload, ignore every other event, and — honouring the non-blocking {@code EventSink} contract on the
 * engine hot path — never let a misbehaving notifier break event emission. The notifier is a Mockito
 * stub, so these run without a socket.
 */
class AlertingEventSinkTest {

    private static final ResourceId PROXY = new ResourceId(ResourceKind.PROXY, "p1");
    private static final Context SCRAPE = new Context("scrape");
    private static final Instant AT = Instant.parse("2026-07-20T10:00:00Z");

    @Test
    void forwardsBlocklistedEventWithPayload() {
        AlertNotifier notifier = mock(AlertNotifier.class);
        AlertingEventSink sink = new AlertingEventSink(notifier);
        Instant until = AT.plusSeconds(3600);

        sink.emit(new PoolEvent.ResourceBlocklisted(PROXY, AT, until));

        ArgumentCaptor<AlertPayload> captor = ArgumentCaptor.forClass(AlertPayload.class);
        verify(notifier).notify(captor.capture());
        AlertPayload payload = captor.getValue();
        assertThat(payload.eventType()).isEqualTo(AlertPayload.RESOURCE_BLOCKLISTED);
        assertThat(payload.resourceKind()).isEqualTo("PROXY");
        assertThat(payload.resourceValue()).isEqualTo("p1");
        assertThat(payload.at()).isEqualTo(AT);
        assertThat(payload.until()).isEqualTo(until);
        assertThat(payload.permanent()).isFalse();
    }

    @Test
    void marksPermanentBlockWithNullUntil() {
        AlertNotifier notifier = mock(AlertNotifier.class);
        AlertingEventSink sink = new AlertingEventSink(notifier);

        sink.emit(new PoolEvent.ResourceBlocklisted(PROXY, AT, Instant.MAX));

        ArgumentCaptor<AlertPayload> captor = ArgumentCaptor.forClass(AlertPayload.class);
        verify(notifier).notify(captor.capture());
        assertThat(captor.getValue().permanent()).isTrue();
        assertThat(captor.getValue().until()).isNull();
    }

    @Test
    void ignoresNonBlocklistEvents() {
        AlertNotifier notifier = mock(AlertNotifier.class);
        AlertingEventSink sink = new AlertingEventSink(notifier);

        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT, AT.plusSeconds(30)));
        sink.emit(new PoolEvent.ResourceUnblocked(PROXY, AT));
        sink.emit(new PoolEvent.ResourceRecovered(PROXY, SCRAPE, AT));
        sink.emit(new PoolEvent.LeaseReleased(PROXY, SCRAPE, AT));

        verify(notifier, never()).notify(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void swallowsNotifierFailureSoTheEngineKeepsFlowing() {
        AlertNotifier notifier = mock(AlertNotifier.class);
        doThrow(new RuntimeException("boom")).when(notifier).notify(org.mockito.ArgumentMatchers.any());
        AlertingEventSink sink = new AlertingEventSink(notifier);

        assertThatCode(() -> sink.emit(new PoolEvent.ResourceBlocklisted(PROXY, AT, AT.plusSeconds(60))))
                .doesNotThrowAnyException();
    }
}
