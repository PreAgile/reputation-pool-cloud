package io.github.preagile.reputationpool.cloud.security;

import io.grpc.ServerInterceptor;
import net.devh.boot.grpc.server.interceptor.GrpcGlobalServerInterceptor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the {@link ApiKeyAuthInterceptor} as a global gRPC server interceptor, so every service
 * (the advisor, plus gRPC health/reflection) is guarded by the API key. Issue #9 will layer real
 * tenant resolution on top of this same interceptor point.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SecurityProperties.class)
public class GrpcSecurityConfiguration {

    @Bean
    @GrpcGlobalServerInterceptor
    ServerInterceptor apiKeyAuthInterceptor(SecurityProperties properties) {
        return new ApiKeyAuthInterceptor(properties.apiKey());
    }
}
