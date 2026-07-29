package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.grpc.Context;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.Status;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

@DisplayName("RateLimitInterceptor: 인증된 테넌트의 gRPC 호출에 상한을 적용하는 인터셉터")
class RateLimitInterceptorTest {

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-07-29T00:00:00Z"), ZoneOffset.UTC);

    private MeterRegistry registry;

    @SuppressWarnings("unchecked")
    private ServerCall<String, String> call;

    @SuppressWarnings("unchecked")
    private ServerCallHandler<String, String> next;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registry = new SimpleMeterRegistry();
        call = mock(ServerCall.class);
        next = mock(ServerCallHandler.class);
        when(next.startCall(any(), any())).thenReturn(new ServerCall.Listener<>() {});
    }

    /** 인터셉터를 테넌트가 붙은 gRPC Context 안에서 호출한다 — 실제 인증 인터셉터가 만드는 상태와 같다. */
    private void interceptAs(String tenantId, RateLimitInterceptor interceptor) {
        Context context =
                tenantId == null ? Context.current() : Context.current().withValue(TenantContext.TENANT_ID, tenantId);
        context.run(() -> interceptor.interceptCall(call, new Metadata(), next));
    }

    private static RateLimitInterceptor interceptor(MeterRegistry registry, boolean enabled, int burst) {
        RateLimiter limiter = new RateLimiter(new RateLimitProperties(enabled, 1, burst), FIXED);
        return new RateLimitInterceptor(limiter, registry);
    }

    @Test
    @DisplayName("상한 안이면 → 호출을 그대로 다음 핸들러로 넘긴다")
    void passesThroughWithinLimit() {
        RateLimitInterceptor interceptor = interceptor(registry, true, 5);

        interceptAs("tenant-a", interceptor);

        verify(next).startCall(any(), any());
        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("상한을 넘기면 → RESOURCE_EXHAUSTED 로 닫고 다음 핸들러를 부르지 않는다")
    void rejectsOverLimit() {
        RateLimitInterceptor interceptor = interceptor(registry, true, 1);
        interceptAs("tenant-a", interceptor); // 토큰 소진

        interceptAs("tenant-a", interceptor);

        ArgumentCaptor<Status> status = ArgumentCaptor.forClass(Status.class);
        verify(call).close(status.capture(), any());
        assertThat(status.getValue().getCode()).isEqualTo(Status.Code.RESOURCE_EXHAUSTED);
        // 첫 호출만 통과했어야 한다.
        verify(next).startCall(any(), any());
    }

    @Test
    @DisplayName("거부 응답에 retry-after 를 초 단위로 실어 보낸다 → 클라이언트가 언제 다시 올지 안다")
    void attachesRetryAfterMetadata() {
        RateLimitInterceptor interceptor = interceptor(registry, true, 1);
        interceptAs("tenant-a", interceptor);

        interceptAs("tenant-a", interceptor);

        ArgumentCaptor<Metadata> trailers = ArgumentCaptor.forClass(Metadata.class);
        verify(call).close(any(), trailers.capture());
        String retryAfter = trailers.getValue().get(RateLimitInterceptor.RETRY_AFTER);
        assertThat(retryAfter).isNotNull();
        assertThat(Long.parseLong(retryAfter)).isGreaterThanOrEqualTo(1L);
    }

    @Test
    @DisplayName("거부하면 카운터가 오른다 → 알림 룰이 볼 신호가 생긴다")
    void countsRejections() {
        RateLimitInterceptor interceptor = interceptor(registry, true, 1);
        interceptAs("tenant-a", interceptor);

        interceptAs("tenant-a", interceptor);

        assertThat(registry.counter("datapane.rate.limited").count()).isEqualTo(1.0d);
    }

    @Test
    @DisplayName("거부가 없어도 카운터는 0 으로 존재한다 → 없는 시계열과 0 은 알림 룰에 다른 의미다")
    void countersExistAtZero() {
        interceptor(registry, true, 5);

        assertThat(registry.find("datapane.rate.limited").counter()).isNotNull();
        assertThat(registry.find("datapane.rate.limiter.errors").counter()).isNotNull();
    }

    @Test
    @DisplayName("컨텍스트에 테넌트가 없으면 → 막지 않고 넘긴다 (인증이 판단할 몫이다)")
    void passesThroughWhenTenantMissing() {
        RateLimitInterceptor interceptor = interceptor(registry, true, 1);

        interceptAs(null, interceptor);
        interceptAs(null, interceptor);

        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("제한기가 예외를 던지면 → 호출을 통과시키되 에러 카운터를 올린다 (용량 제어는 fail-open)")
    void failsOpenWhenLimiterThrows() {
        // 제한기 자체가 깨진 상황을 만든다. 실제 구현을 상속해 흉내 내는 대신 mock 을 쓰는 이유는
        // RateLimiter 가 final 이어야 하기 때문이다 — 테스트를 위해 상속 가능하게 여는 것은 설계를
        // 검증 도구에 맞춰 무르게 만드는 일이다.
        RateLimiter broken = mock(RateLimiter.class);
        when(broken.enabled()).thenReturn(true);
        when(broken.check(any())).thenThrow(new IllegalStateException("boom"));
        RateLimitInterceptor interceptor = new RateLimitInterceptor(broken, registry);

        interceptAs("tenant-a", interceptor);

        verify(next).startCall(any(), any());
        verify(call, never()).close(any(), any());
        assertThat(registry.counter("datapane.rate.limiter.errors").count()).isEqualTo(1.0d);
    }

    @Test
    @DisplayName("비활성화하면 → 테넌트가 있어도 무제한으로 통과시킨다")
    void disabledPassesEverything() {
        RateLimitInterceptor interceptor = interceptor(registry, false, 1);

        for (int i = 0; i < 10; i++) {
            interceptAs("tenant-a", interceptor);
        }

        verify(call, never()).close(any(), any());
    }
}
