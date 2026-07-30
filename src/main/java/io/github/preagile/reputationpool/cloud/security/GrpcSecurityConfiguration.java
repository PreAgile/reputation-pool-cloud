package io.github.preagile.reputationpool.cloud.security;

import io.grpc.ServerInterceptor;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import javax.sql.DataSource;
import net.devh.boot.grpc.server.interceptor.GrpcGlobalServerInterceptor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

/**
 * Wires API-key authentication: the {@link TenantResolver} that maps a key hash to its tenant, the
 * global gRPC interceptor that enforces it on every service (advisor + gRPC health/reflection), and the
 * startup {@link ApiKeySeeder} that carries the single-key env UX onto the table model. Issue #9b layers
 * per-tenant pool routing on top of the tenant this interceptor resolves.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({SecurityProperties.class, RateLimitProperties.class})
public class GrpcSecurityConfiguration {

    @Bean
    TenantResolver tenantResolver(DataSource dataSource) {
        return new JdbcTenantResolver(dataSource);
    }

    /**
     * Interceptor order is explicit because it is a correctness requirement, not a preference: the rate
     * limiter reads the tenant that authentication resolves, so it must run second. Without these
     * annotations the order is whatever the framework happens to produce, and if it ever flipped the
     * limiter would silently stop limiting (no tenant in context → pass through) rather than fail.
     */
    private static final int AUTH_ORDER = 100;

    private static final int RATE_LIMIT_ORDER = 200;

    /** Also after auth, for the same reason: the quota is keyed by the tenant auth resolves. */
    private static final int STREAM_QUOTA_ORDER = 300;

    @Bean
    @GrpcGlobalServerInterceptor
    @Order(AUTH_ORDER)
    ServerInterceptor apiKeyAuthInterceptor(TenantResolver tenantResolver) {
        return new ApiKeyAuthInterceptor(tenantResolver);
    }

    /** Per-tenant token bucket (issue #132); {@link Clock}-driven so refill is testable. */
    @Bean
    RateLimiter rateLimiter(RateLimitProperties properties, Clock clock) {
        return new RateLimiter(properties, clock);
    }

    @Bean
    @GrpcGlobalServerInterceptor
    @Order(RATE_LIMIT_ORDER)
    ServerInterceptor rateLimitInterceptor(RateLimiter rateLimiter, MeterRegistry meterRegistry) {
        return new RateLimitInterceptor(rateLimiter, meterRegistry);
    }

    /**
     * Concurrent-stream ceiling per tenant (issue #132 follow-up). The token bucket above meters calls,
     * and a {@code SubscribeEvents} call is one call however long it lives — this bounds how many of
     * those a tenant may hold open at once.
     */
    @Bean
    StreamSubscriptionQuota streamSubscriptionQuota(RateLimitProperties properties) {
        return new StreamSubscriptionQuota(properties);
    }

    @Bean
    @GrpcGlobalServerInterceptor
    @Order(STREAM_QUOTA_ORDER)
    ServerInterceptor streamQuotaInterceptor(StreamSubscriptionQuota quota, MeterRegistry meterRegistry) {
        return new StreamQuotaInterceptor(quota, meterRegistry);
    }

    @Bean
    ApiKeySeeder apiKeySeeder(DataSource dataSource, SecurityProperties properties, Clock clock) {
        return new ApiKeySeeder(dataSource, properties, clock);
    }
}
