package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import io.grpc.ServerInterceptor;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Locks in the one thing {@link GrpcSecurityConfiguration}'s javadoc says is a correctness requirement,
 * not a preference: auth runs before the rate limiter, which runs before the stream quota. Nothing in
 * the {@code @Order} constants themselves is checked by the compiler, and the ordering contract that
 * {@code @GrpcGlobalServerInterceptor} beans get sorted by {@code @Order} on the {@code @Bean} method is
 * owned by the net.devh starter — an upgrade could change that silently. If the order ever flipped, the
 * rate limiter and stream quota would read {@link
 * io.github.preagile.reputationpool.cloud.tenant.TenantContext#TENANT_ID} before auth sets it, see
 * {@code null}, and pass every call through unlimited — exactly the failure mode both interceptors'
 * javadoc warns about, and neither interceptor could detect it from the inside.
 */
@DisplayName("GrpcSecurityConfiguration: 전역 인터셉터는 인증 → 요청율 상한 → 스트림 상한 순서로 정렬된다")
class GrpcSecurityConfigurationTest {

    /**
     * {@link GrpcSecurityConfiguration} 이 요구하는 인프라 빈만 최소로 공급한다. {@link ApiKeySeeder} 는
     * {@code ApplicationRunner} 라 {@code AnnotationConfigApplicationContext} 는 실행하지 않으므로,
     * mock {@link DataSource} 를 실제로 두드릴 일이 없다.
     */
    @Configuration
    static class TestInfrastructure {
        @Bean
        DataSource dataSource() {
            return mock(DataSource.class);
        }

        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }

        @Bean
        MeterRegistry meterRegistry() {
            return new SimpleMeterRegistry();
        }
    }

    @Test
    @DisplayName("순서가 뒤집히면 인증 전에 상한이 돌아 tenant 없이 통과한다 — 그 회귀를 여기서 잡는다")
    void interceptorsAreOrderedAfterAuth() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.register(TestInfrastructure.class, GrpcSecurityConfiguration.class);
            context.refresh();

            ObjectProvider<ServerInterceptor> interceptors = context.getBeanProvider(ServerInterceptor.class);
            List<Class<?>> order =
                    interceptors.orderedStream().map(Object::getClass).toList();

            assertThat(order)
                    .as("auth → rate limit → stream quota 순서로 정렬돼야 한다")
                    .containsExactly(
                            ApiKeyAuthInterceptor.class, RateLimitInterceptor.class, StreamQuotaInterceptor.class);
        }
    }
}
