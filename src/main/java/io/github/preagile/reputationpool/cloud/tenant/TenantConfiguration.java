package io.github.preagile.reputationpool.cloud.tenant;

import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires tenant data access. The control plane (#11) and per-tenant routing (#9b) both consume
 * {@link TenantRepository}; keeping the bean here (not in a feature config) reflects that it is shared
 * infrastructure rather than owned by either track.
 */
@Configuration(proxyBeanMethods = false)
public class TenantConfiguration {

    @Bean
    TenantRepository tenantRepository(DataSource dataSource) {
        return new JdbcTenantRepository(dataSource);
    }
}
