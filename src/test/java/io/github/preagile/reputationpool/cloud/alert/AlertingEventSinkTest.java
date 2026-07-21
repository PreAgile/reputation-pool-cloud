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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The alerting sink must forward only {@code BLOCKLISTED} transitions to the notifier, build a faithful
 * payload, ignore every other event, and — honouring the non-blocking {@code EventSink} contract on the
 * engine hot path — never let a misbehaving notifier break event emission. The notifier is a Mockito
 * stub, so these run without a socket.
 */
@DisplayName("AlertingEventSink: BLOCKLISTED 이벤트만 알림으로 전달하는 팬아웃 싱크")
class AlertingEventSinkTest {

    private static final ResourceId PROXY = new ResourceId(ResourceKind.PROXY, "p1");
    private static final Context SCRAPE = new Context("scrape");
    private static final Instant AT = Instant.parse("2026-07-20T10:00:00Z");

    @Test
    @DisplayName("BLOCKLISTED 이벤트가 들어오면 → 리소스 정보를 담은 페이로드로 알림을 전달한다")
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
    @DisplayName("until 이 Instant.MAX 인 영구 차단이면 → until 은 null, permanent 는 true 로 표시한다")
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
    @DisplayName("BLOCKLISTED 가 아닌 다른 이벤트들은 → 알림을 전혀 보내지 않는다")
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
    @DisplayName("알림 전송이 예외를 던져도 → 삼켜서 엔진의 이벤트 발행이 끊기지 않는다")
    void swallowsNotifierFailureSoTheEngineKeepsFlowing() {
        AlertNotifier notifier = mock(AlertNotifier.class);
        doThrow(new RuntimeException("boom")).when(notifier).notify(org.mockito.ArgumentMatchers.any());
        AlertingEventSink sink = new AlertingEventSink(notifier);

        assertThatCode(() -> sink.emit(new PoolEvent.ResourceBlocklisted(PROXY, AT, AT.plusSeconds(60))))
                .doesNotThrowAnyException();
    }
}
