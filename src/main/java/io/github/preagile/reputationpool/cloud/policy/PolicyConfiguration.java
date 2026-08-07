package io.github.preagile.reputationpool.cloud.policy;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires per-tenant engine policy (issue #179). Data access is a plain-JDBC adapter declared explicitly
 * as a bean rather than component-scanned, matching {@code TenantConfiguration} and
 * {@code ControlPlaneConfiguration}.
 *
 * <p>Both the engine ({@code PerTenantPoolRegistry}, which reads the effective policy when it builds a
 * pool) and the control plane ({@code EnginePolicyController}, which writes one) consume these beans, so
 * they live here rather than inside either track's configuration.
 */
@Configuration(proxyBeanMethods = false)
public class PolicyConfiguration {

    @Bean
    EnginePolicyRepository enginePolicyRepository(DataSource dataSource) {
        return new JdbcEnginePolicyRepository(dataSource);
    }

    /**
     * The upper bound a stored policy may reach on this instance, derived once from static configuration
     * — see {@link EnginePolicyCeiling} for why it is a multiple of this instance's own defaults rather
     * than a share of the global resource budget.
     */
    @Bean
    EnginePolicyCeiling enginePolicyCeiling(ReputationPoolProperties properties) {
        return EnginePolicyCeiling.from(properties);
    }

    /**
     * The lookup the registry builds pools from: the tenant's stored policy, falling back to the
     * instance-wide defaults assembled from {@code reputation-pool.engine.*} and
     * {@code reputation-pool.lease-ttl}. With no rows stored, that fallback reproduces exactly the
     * behaviour every tenant had before this issue.
     */
    @Bean
    StoredEnginePolicySource enginePolicySource(
            EnginePolicyRepository repository, ReputationPoolProperties properties) {
        return new StoredEnginePolicySource(repository, EnginePolicy.defaultsFrom(properties));
    }
}
