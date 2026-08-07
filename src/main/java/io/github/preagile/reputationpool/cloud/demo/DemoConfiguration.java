package io.github.preagile.reputationpool.cloud.demo;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the demo tenant seeder (issue #31 follow-up), explicitly rather than by component scan — the
 * idiom the rest of this repo's data-access and startup components follow.
 *
 * <p>{@link ConditionalOnProperty} keeps the bean itself out of the context unless the feature is
 * switched on. The seeder also checks {@link DemoDataProperties#enabled()} at run time, so the guard is
 * doubled deliberately: the condition means a production context does not even contain the class, and the
 * run-time check means the class is still safe if it is ever constructed some other way (a test, a future
 * caller). Neither alone is worth relying on for something that deletes rows.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DemoDataProperties.class)
@ConditionalOnProperty(prefix = "reputation-pool.demo", name = "enabled", havingValue = "true")
public class DemoConfiguration {

    @Bean
    DemoDataSeeder demoDataSeeder(
            DataSource dataSource,
            DemoDataProperties demo,
            ReputationPoolProperties engineProperties,
            PerTenantPoolRegistry registry,
            GlobalResourceBudget budget,
            Clock clock) {
        return new DemoDataSeeder(dataSource, demo, engineProperties, registry, budget, clock);
    }
}
