package io.github.preagile.reputationpool.cloud.security;

import io.grpc.ServerInterceptor;
import java.time.Clock;
import javax.sql.DataSource;
import net.devh.boot.grpc.server.interceptor.GrpcGlobalServerInterceptor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires API-key authentication: the {@link TenantResolver} that maps a key hash to its tenant, the
 * global gRPC interceptor that enforces it on every service (advisor + gRPC health/reflection), and the
 * startup {@link ApiKeySeeder} that carries the single-key env UX onto the table model. Issue #9b layers
 * per-tenant pool routing on top of the tenant this interceptor resolves.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SecurityProperties.class)
public class GrpcSecurityConfiguration {

    @Bean
    TenantResolver tenantResolver(DataSource dataSource) {
        return new JdbcTenantResolver(dataSource);
    }

    @Bean
    @GrpcGlobalServerInterceptor
    ServerInterceptor apiKeyAuthInterceptor(TenantResolver tenantResolver) {
        return new ApiKeyAuthInterceptor(tenantResolver);
    }

    @Bean
    ApiKeySeeder apiKeySeeder(DataSource dataSource, SecurityProperties properties, Clock clock) {
        return new ApiKeySeeder(dataSource, properties, clock);
    }
}
