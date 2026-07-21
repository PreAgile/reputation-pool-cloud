package io.github.preagile.reputationpool.cloud.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The webhook notifier's two invariants, verified against a mocked {@link HttpClient} (no socket): it is
 * a total no-op when alerting is inactive (opt-in / fail-safe), and when active it dispatches exactly one
 * async POST to the configured URL — and never throws back at the caller even if the send fails.
 */
@DisplayName("WebhookAlertNotifier: 활성일 때만 웹훅으로 비동기 POST 를 쏘는 알림 전송기")
class WebhookAlertNotifierTest {

    private static final Duration T = Duration.ofSeconds(2);
    private static final AlertPayload PAYLOAD = new AlertPayload(
            AlertPayload.RESOURCE_BLOCKLISTED, "PROXY", "p1", Instant.parse("2026-07-20T10:00:00Z"), null, true);

    /** An ObjectMapper with JSR-310 registered, mirroring the JavaTimeModule Spring Boot auto-configures. */
    private static ObjectMapper mapper() {
        return new ObjectMapper().findAndRegisterModules();
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("알림이 비활성화(enabled=false)면 → HTTP 호출 없이 아무것도 하지 않는다")
    void isNoOpWhenInactive() {
        HttpClient client = mock(HttpClient.class);
        WebhookAlertNotifier notifier =
                new WebhookAlertNotifier(new AlertProperties(false, "https://hooks.example/x", T), client, mapper());

        notifier.notify(PAYLOAD);

        verify(client, never()).sendAsync(any(), any(HttpResponse.BodyHandler.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("활성이어도 웹훅 URL 이 비어 있으면 → HTTP 호출 없이 아무것도 하지 않는다")
    void isNoOpWhenUrlBlank() {
        HttpClient client = mock(HttpClient.class);
        WebhookAlertNotifier notifier = new WebhookAlertNotifier(new AlertProperties(true, "", T), client, mapper());

        notifier.notify(PAYLOAD);

        verify(client, never()).sendAsync(any(), any(HttpResponse.BodyHandler.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("활성 상태면 → 설정된 URL 로 JSON 비동기 POST 를 정확히 한 번 전송한다")
    void dispatchesOneAsyncPostWhenActive() {
        HttpClient client = mock(HttpClient.class);
        HttpResponse<Void> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(client.sendAsync(any(), any(HttpResponse.BodyHandler.class)))
                .thenReturn(CompletableFuture.completedFuture(response));
        WebhookAlertNotifier notifier =
                new WebhookAlertNotifier(new AlertProperties(true, "https://hooks.example/hook", T), client, mapper());

        notifier.notify(PAYLOAD);

        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        verify(client).sendAsync(captor.capture(), any(HttpResponse.BodyHandler.class));
        HttpRequest request = captor.getValue();
        assertThat(request.uri()).hasToString("https://hooks.example/hook");
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.headers().firstValue("Content-Type")).contains("application/json");
        assertThat(request.timeout()).contains(T);
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("전송이 실패(IOException)해도 → 호출자에게 예외를 던지지 않고 삼킨다")
    void swallowsSendFailure() {
        HttpClient client = mock(HttpClient.class);
        when(client.sendAsync(any(), any(HttpResponse.BodyHandler.class)))
                .thenReturn(CompletableFuture.failedFuture(new java.io.IOException("connect refused")));
        WebhookAlertNotifier notifier =
                new WebhookAlertNotifier(new AlertProperties(true, "https://hooks.example/hook", T), client, mapper());

        assertThatCode(() -> notifier.notify(PAYLOAD)).doesNotThrowAnyException();
    }
}
