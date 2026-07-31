package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.Context;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.Status;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.InputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

@DisplayName("StreamQuotaInterceptor: 서버 스트리밍 구독만 골라 테넌트별 동시 상한을 적용하는 인터셉터")
class StreamQuotaInterceptorTest {

    /** 이 상한이 실제로 겨냥하는 단 하나의 RPC — 다른 server-streaming 메서드와 구분하는 기준. */
    private static final String SUBSCRIBE_EVENTS_METHOD =
            ReputationAdvisorGrpc.getSubscribeEventsMethod().getFullMethodName();

    /** 프로토 없이 메서드 타입만 필요하므로 문자열 마셜러로 최소 디스크립터를 만든다. */
    private static final MethodDescriptor.Marshaller<String> MARSHALLER = new MethodDescriptor.Marshaller<>() {
        @Override
        public InputStream stream(String value) {
            throw new UnsupportedOperationException("직렬화하지 않는다 — 타입만 본다");
        }

        @Override
        public String parse(InputStream stream) {
            throw new UnsupportedOperationException("역직렬화하지 않는다 — 타입만 본다");
        }
    };

    private MeterRegistry registry;

    @SuppressWarnings("unchecked")
    private ServerCall<String, String> call;

    @SuppressWarnings("unchecked")
    private ServerCallHandler<String, String> next;

    private ServerCall.Listener<String> delegate;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        registry = new SimpleMeterRegistry();
        call = mock(ServerCall.class);
        next = mock(ServerCallHandler.class);
        delegate = new ServerCall.Listener<>() {};
        when(next.startCall(any(), any())).thenReturn(delegate);
    }

    /**
     * {@code SERVER_STREAMING} 은 실제 {@code SubscribeEvents} 를 흉내 내고, 그 밖의 타입은 이 상한이
     * 겨냥하지 않는 임의의 RPC(가짜 이름 "Probe")를 흉내 낸다 — 상한이 이름으로만 판별되므로 그 구분이
     * 여기서부터 맞아야 한다.
     */
    private static MethodDescriptor<String, String> method(MethodDescriptor.MethodType type) {
        String fullMethodName = type == MethodDescriptor.MethodType.SERVER_STREAMING
                ? SUBSCRIBE_EVENTS_METHOD
                : "reputationpool.v1.ReputationAdvisor/Probe";
        return method(type, fullMethodName);
    }

    private static MethodDescriptor<String, String> method(MethodDescriptor.MethodType type, String fullMethodName) {
        return MethodDescriptor.<String, String>newBuilder()
                .setType(type)
                .setFullMethodName(fullMethodName)
                .setRequestMarshaller(MARSHALLER)
                .setResponseMarshaller(MARSHALLER)
                .build();
    }

    private ServerCall.Listener<String> interceptAs(
            String tenantId, StreamQuotaInterceptor interceptor, MethodDescriptor.MethodType type) {
        return interceptAs(tenantId, interceptor, method(type));
    }

    private ServerCall.Listener<String> interceptAs(
            String tenantId, StreamQuotaInterceptor interceptor, MethodDescriptor<String, String> descriptor) {
        when(call.getMethodDescriptor()).thenReturn(descriptor);
        Context context =
                tenantId == null ? Context.current() : Context.current().withValue(TenantContext.TENANT_ID, tenantId);
        java.util.concurrent.atomic.AtomicReference<ServerCall.Listener<String>> captured =
                new java.util.concurrent.atomic.AtomicReference<>();
        context.run(() -> captured.set(interceptor.interceptCall(call, new Metadata(), next)));
        return captured.get();
    }

    private StreamQuotaInterceptor interceptor(StreamSubscriptionQuota quota) {
        return new StreamQuotaInterceptor(quota, registry);
    }

    private static StreamSubscriptionQuota quota(int maxStreams) {
        return new StreamSubscriptionQuota(new RateLimitProperties(true, 10, 50, maxStreams));
    }

    @Test
    @DisplayName("구독이 없어도 카운터는 0 으로 존재한다 → 없는 시계열과 0 은 알림 룰에 다른 의미다")
    void countersExistAtZero() {
        interceptor(quota(2));

        assertThat(registry.find("datapane.stream.subscriptions.rejected").counter())
                .isNotNull();
        assertThat(registry.find("datapane.stream.quota.errors").counter()).isNotNull();
    }

    @Test
    @DisplayName("enabled=false 면 → 상한이 1 이어도 여러 구독을 그냥 통과시킨다 (rate-limit.enabled 가 한 스위치다)")
    void disabledQuotaAdmitsEverything() throws Exception {
        StreamSubscriptionQuota quota = new StreamSubscriptionQuota(new RateLimitProperties(false, 10, 50, 1));
        StreamQuotaInterceptor interceptor = interceptor(quota);

        for (int i = 0; i < 5; i++) {
            interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);
        }

        assertThat(quota.openCount("acme")).isZero();
        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("일반(unary) 호출이면 → 슬롯을 쓰지 않고 그대로 통과시킨다")
    void unaryCallsAreNotCounted() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);

        for (int i = 0; i < 5; i++) {
            interceptAs("acme", interceptor, MethodDescriptor.MethodType.UNARY);
        }

        assertThat(quota.openCount("acme")).isZero();
        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("SubscribeEvents 가 아닌 다른 server-streaming RPC 는 → 슬롯을 쓰지 않고 그대로 통과시킨다")
    void otherServerStreamingRpcsAreNotCounted() throws Exception {
        // 이 인터셉터는 전역 등록이라 gRPC health/reflection 의 스트리밍 메서드도 지나간다. 타입만 보면
        // 그런 메서드도 SubscribeEvents 와 같은 슬롯을 소비하게 된다 — 이름으로 걸러야 한다.
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        MethodDescriptor<String, String> otherStreamingMethod =
                method(MethodDescriptor.MethodType.SERVER_STREAMING, "grpc.health.v1.Health/Watch");

        for (int i = 0; i < 5; i++) {
            interceptAs("acme", interceptor, otherStreamingMethod);
        }

        assertThat(quota.openCount("acme")).isZero();
        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("서버 스트리밍이면 → 슬롯을 하나 쓰고 핸들러로 넘긴다")
    void streamingCallClaimsASlot() throws Exception {
        StreamSubscriptionQuota quota = quota(2);

        interceptAs("acme", interceptor(quota), MethodDescriptor.MethodType.SERVER_STREAMING);

        assertThat(quota.openCount("acme")).isEqualTo(1);
        verify(next).startCall(any(), any());
        verify(call, never()).close(any(), any());
    }

    @Test
    @DisplayName("상한을 넘겨 구독하면 → RESOURCE_EXHAUSTED 로 닫고 핸들러를 부르지 않는다")
    void refusesBeyondCeiling() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);

        interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);

        ArgumentCaptor<Status> status = ArgumentCaptor.forClass(Status.class);
        verify(call).close(status.capture(), any());
        assertThat(status.getValue().getCode()).isEqualTo(Status.Code.RESOURCE_EXHAUSTED);
        assertThat(status.getValue().getDescription()).contains("concurrent event subscriptions");
        assertThat(registry.counter("datapane.stream.subscriptions.rejected").count())
                .isEqualTo(1.0d);
        // 상한을 넘긴 호출은 핸들러에 닿지 않는다 — 첫 호출 한 번만 넘어갔어야 한다.
        verify(next).startCall(any(), any());
    }

    @Test
    @DisplayName("거절에는 retry-after 를 붙이지 않는다 → 시간이 아니라 다른 스트림이 닫혀야 열린다")
    void rejectionCarriesNoRetryAfter() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);

        interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);

        ArgumentCaptor<Metadata> trailers = ArgumentCaptor.forClass(Metadata.class);
        verify(call).close(any(), trailers.capture());
        assertThat(trailers.getValue().containsKey(RateLimitInterceptor.RETRY_AFTER))
                .isFalse();
    }

    @Test
    @DisplayName("클라이언트가 스트림을 끊으면 → 슬롯이 반납돼 다음 구독이 들어간다")
    void cancelReleasesTheSlot() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        ServerCall.Listener<String> listener =
                interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);
        assertThat(quota.openCount("acme")).isEqualTo(1);

        listener.onCancel();

        assertThat(quota.openCount("acme")).isZero();
    }

    @Test
    @DisplayName("스트림이 정상 종료돼도 → 슬롯이 반납된다")
    void completeReleasesTheSlot() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        ServerCall.Listener<String> listener =
                interceptAs("acme", interceptor(quota), MethodDescriptor.MethodType.SERVER_STREAMING);

        listener.onComplete();

        assertThat(quota.openCount("acme")).isZero();
    }

    @Test
    @DisplayName("종료 콜백이 두 번 와도 → 슬롯은 한 번만 반납된다 (없는 여유가 생기지 않는다)")
    void releaseHappensExactlyOnce() throws Exception {
        StreamSubscriptionQuota quota = quota(2);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        ServerCall.Listener<String> a = interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);
        interceptAs("acme", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);
        assertThat(quota.openCount("acme")).isEqualTo(2);

        a.onCancel();
        a.onCancel();
        a.onComplete();

        // 한 번만 반납됐다면 1 이 남는다. 세 번 반납됐다면 0 이 되어 상한이 조용히 늘어난다.
        assertThat(quota.openCount("acme")).isEqualTo(1);
    }

    @Test
    @DisplayName("핸들러 시작이 예외로 죽어도 → 슬롯을 물고 있지 않는다")
    void handlerFailureDoesNotLeakASlot() {
        StreamSubscriptionQuota quota = quota(1);
        when(next.startCall(any(), any())).thenThrow(new IllegalStateException("boom"));
        when(call.getMethodDescriptor()).thenReturn(method(MethodDescriptor.MethodType.SERVER_STREAMING));
        StreamQuotaInterceptor interceptor = interceptor(quota);

        Context context = Context.current().withValue(TenantContext.TENANT_ID, "acme");
        try {
            context.run(() -> interceptor.interceptCall(call, new Metadata(), next));
        } catch (IllegalStateException expected) {
            // 예외는 그대로 올라간다 — 삼키지 않는다.
        }

        assertThat(quota.openCount("acme")).isZero();
    }

    @Test
    @DisplayName("게이트가 예외를 던지면 → 구독을 통과시키고 에러 카운터를 올린다 (fail-open)")
    void quotaFailureLetsSubscriptionThrough() throws Exception {
        StreamSubscriptionQuota broken = mock(StreamSubscriptionQuota.class);
        when(broken.enabled()).thenReturn(true);
        when(broken.tryOpen(any())).thenThrow(new IllegalStateException("boom"));

        interceptAs("acme", interceptor(broken), MethodDescriptor.MethodType.SERVER_STREAMING);

        verify(next).startCall(any(), any());
        verify(call, never()).close(any(), any());
        assertThat(registry.counter("datapane.stream.quota.errors").count()).isEqualTo(1.0d);
    }

    @Test
    @DisplayName("인증 전이라 테넌트가 없으면 → 슬롯을 쓰지 않고 통과시킨다 (판단은 auth 에 맡긴다)")
    void missingTenantPassesThrough() throws Exception {
        StreamSubscriptionQuota quota = quota(1);

        interceptAs(null, interceptor(quota), MethodDescriptor.MethodType.SERVER_STREAMING);

        assertThat(quota.trackedTenantCount()).isZero();
        verify(next).startCall(any(), any());
    }

    @Test
    @DisplayName("테넌트마다 슬롯이 따로다 → 한 테넌트가 소진해도 다른 테넌트는 구독할 수 있다")
    void slotsAreIsolatedPerTenant() throws Exception {
        StreamSubscriptionQuota quota = quota(1);
        StreamQuotaInterceptor interceptor = interceptor(quota);
        interceptAs("noisy", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);
        interceptAs("noisy", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING); // 거절

        interceptAs("quiet", interceptor, MethodDescriptor.MethodType.SERVER_STREAMING);

        assertThat(quota.openCount("quiet")).isEqualTo(1);
        assertThat(registry.counter("datapane.stream.subscriptions.rejected").count())
                .isEqualTo(1.0d);
    }
}
