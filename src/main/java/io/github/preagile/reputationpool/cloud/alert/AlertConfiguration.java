package io.github.preagile.reputationpool.cloud.alert;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Spring wiring for the state-transition alerting slice (issue #45, slice A). Mirrors the
 * {@code SecurityConfiguration} pattern: bind {@link AlertProperties} via
 * {@link EnableConfigurationProperties} and expose the collaborators as beans.
 *
 * <p>The beans are registered unconditionally on purpose — the whole path is opt-in and fail-safe, so
 * when alerting is disabled (the default) the notifier is a no-op and the sink forwards nothing. That
 * lets {@code EngineConfiguration} always include {@link AlertingEventSink} in the fan-out sink without
 * any conditional wiring.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AlertProperties.class)
public class AlertConfiguration {

    /**
     * The default webhook notifier. The JDK {@link HttpClient} (no new dependency) is built here with the
     * configured connect timeout; the notifier itself dispatches every send asynchronously so the engine
     * thread never blocks, and swallows all failures so an alert can never break the engine.
     */
    @Bean
    AlertNotifier alertNotifier(AlertProperties properties, ObjectMapper objectMapper) {
        HttpClient httpClient =
                HttpClient.newBuilder().connectTimeout(properties.timeout()).build();
        return new WebhookAlertNotifier(properties, httpClient, objectMapper);
    }

    /** The fan-out sink member that forwards BLOCKLISTED transitions to the notifier. */
    @Bean
    AlertingEventSink alertingEventSink(AlertNotifier alertNotifier) {
        return new AlertingEventSink(alertNotifier);
    }
}
