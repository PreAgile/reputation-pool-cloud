package io.github.preagile.reputationpool.cloud.alert;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The default {@link AlertNotifier}: POSTs the alert as JSON to a configured webhook (issue #45, slice
 * A), using only the JDK {@link HttpClient} (no new dependency).
 *
 * <p><b>Never blocks the engine.</b> {@link #notify(AlertPayload)} is called from the engine's event
 * emission, so the actual HTTP round-trip is dispatched with {@link HttpClient#sendAsync} — it returns a
 * future immediately and runs on the client's own executor, never on the emitting thread. The request
 * carries a {@link AlertProperties#timeout()} so a hung endpoint cannot pin a background thread forever.
 *
 * <p><b>Never throws, fail-safe.</b> Every failure mode — inactive config, JSON serialization, the async
 * send, a non-2xx response, a timeout — is caught and logged at most; nothing propagates back to the
 * engine. When {@link AlertProperties#active()} is false (opt-in default, or a blank URL) this is a total
 * no-op: no request is built and no thread is touched.
 */
public final class WebhookAlertNotifier implements AlertNotifier {

    private static final Logger log = LoggerFactory.getLogger(WebhookAlertNotifier.class);

    private final AlertProperties properties;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public WebhookAlertNotifier(AlertProperties properties, HttpClient httpClient, ObjectMapper objectMapper) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    public void notify(AlertPayload payload) {
        if (!properties.active()) {
            return; // opt-in / fail-safe: disabled or no URL configured -> complete no-op
        }
        try {
            byte[] body = objectMapper.writeValueAsBytes(payload);
            Duration timeout = properties.timeout();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(properties.webhookUrl().strip()))
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            // Fire-and-forget: returns immediately on the caller (engine) thread; the round-trip runs on
            // the HttpClient's executor. Outcomes (including failures) are handled off-thread and swallowed.
            httpClient
                    .sendAsync(request, HttpResponse.BodyHandlers.discarding())
                    .whenComplete((response, error) -> {
                        if (error != null) {
                            log.warn("alert webhook POST failed for {}", payload.eventType(), error);
                        } else if (response.statusCode() / 100 != 2) {
                            log.warn("alert webhook returned {} for {}", response.statusCode(), payload.eventType());
                        }
                    });
        } catch (RuntimeException | java.io.IOException e) {
            // Building the request / serializing must never break the engine; swallow and log.
            log.warn("could not dispatch alert webhook for {}", payload.eventType(), e);
        }
    }
}
