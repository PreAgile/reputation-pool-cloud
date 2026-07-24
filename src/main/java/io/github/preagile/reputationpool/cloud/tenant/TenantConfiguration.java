package io.github.preagile.reputationpool.cloud.tenant;

import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
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

    @Bean
    TenantLifecycleService tenantLifecycleService(
            TenantRepository tenantRepository, TenantPoolRegistry registry, GlobalResourceBudget budget) {
        return new TenantLifecycleService(tenantRepository, registry, budget);
    }
}
