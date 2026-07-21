package io.github.preagile.reputationpool.cloud.alert;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * State-transition alerting configuration bound from {@code reputation-pool.alerts.*} (issue #45, slice
 * A). When a resource is blocklisted the engine emits a {@code ResourceBlocklisted} fact; this turns that
 * fact into an outbound webhook so an operator is told even when nobody is watching the dashboard.
 *
 * <p><b>Opt-in and fail-safe.</b> Alerting is off unless an operator deliberately turns it on: both
 * {@link #enabled} defaults to {@code false} and {@link #webhookUrl} defaults to empty. {@link #active()}
 * is the single gate — only a run with {@code enabled=true} <em>and</em> a non-blank URL sends anything.
 * Any other combination is a complete no-op, so the feature can ship dark and never risk the engine.
 *
 * @param enabled master switch; {@code false} by default (nothing is sent until explicitly enabled)
 * @param webhookUrl the {@code http(s)} endpoint the alert JSON is POSTed to; empty by default (no-op)
 * @param timeout connect/request timeout for the webhook POST; the notifier never blocks the engine
 */
@ConfigurationProperties("reputation-pool.alerts")
public record AlertProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("") String webhookUrl,
        @DefaultValue("PT2S") Duration timeout) {

    /**
     * Fail fast on misconfiguration. Spring binds this record at startup, so a bad value aborts the boot
     * with a clear message instead of silently swallowing every alert later (a malformed URL would only
     * surface as a swallowed send failure). A blank URL is allowed — that is simply the disabled state.
     *
     * @throws IllegalArgumentException if the timeout is non-positive, or a non-blank URL is not a
     *     well-formed http(s) URL with a host
     */
    public AlertProperties {
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("alerts.timeout must be a positive duration, but was " + timeout);
        }
        if (webhookUrl != null && !webhookUrl.isBlank()) {
            String trimmed = webhookUrl.strip();
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
                throw new IllegalArgumentException("alerts.webhook-url must be an http(s) URL, but was " + webhookUrl);
            }
            // Prefix alone is not enough: values like "https://" (no host) or one with embedded whitespace
            // pass the check above but blow up later in URI.create()/HttpRequest — and the notifier swallows
            // that, so alerting would be a silent no-op despite enabled=true. Parse it here so a malformed
            // URL aborts the boot (fail-fast), which is the documented contract.
            URI uri;
            try {
                uri = new URI(trimmed);
            } catch (URISyntaxException e) {
                throw new IllegalArgumentException("alerts.webhook-url is not a valid URI, but was " + webhookUrl, e);
            }
            if (uri.getHost() == null || uri.getHost().isBlank()) {
                throw new IllegalArgumentException("alerts.webhook-url must have a host, but was " + webhookUrl);
            }
        }
    }

    /**
     * Whether alerting is armed: enabled with a real destination. The one gate the notifier checks; a
     * {@code false} here means a total no-op (opt-in / fail-safe).
     */
    public boolean active() {
        return enabled && webhookUrl != null && !webhookUrl.isBlank();
    }
}
