package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the control plane's read-side infrastructure (issue #11). The {@link AuditEventReader} is a
 * plain-JDBC query object built from the shared {@code DataSource}, declared here as a bean to match
 * the repo's idiom of wiring data-access adapters explicitly (like {@code TenantConfiguration}) rather
 * than component-scanning them. The controllers and the auth/key services are wired elsewhere
 * (component scan and {@code SecurityConfiguration} respectively).
 */
@Configuration(proxyBeanMethods = false)
public class ControlPlaneConfiguration {

    @Bean
    AuditEventReader auditEventReader(DataSource dataSource) {
        return new AuditEventReader(dataSource);
    }
}
