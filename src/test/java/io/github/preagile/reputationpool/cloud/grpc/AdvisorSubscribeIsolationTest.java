package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.PoolEvent.EventCase;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.SubscribeEventsRequest;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.Contexts;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.ServerInterceptors;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import io.grpc.stub.StreamObserver;
import java.time.Instant;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The event-stream isolation penetration test (#29): cloud's {@code subscriptionPoolId()} override scopes
 * each {@code SubscribeEvents} subscription to the tenant on the gRPC context, so paired with the emit-side
 * {@code broadcaster.forPool(tenantId)} wiring a subscriber receives only its own tenant's events. One
 * shared {@link EventBroadcaster} backs both the service's subscription registry and the per-tenant emit
 * views, exactly as the composition root wires it. Docker-free (in-process transport, {@code directExecutor}
 * so delivery is synchronous), so it runs in the {@code build} gate.
 *
 * <p>Regression guard: were the seam left at its {@code "default"} base default, a {@code forPool(tenantId)}
 * emit would never reach the (default-scoped) subscriber and the first assertion would time out.
 */
@DisplayName("ReputationAdvisorService(subscribe): 인증된 테넌트의 SubscribeEvents 구독을 그 테넌트 풀로 스코프해 이벤트 스트림을 격리하는 gRPC 어드바이저")
class AdvisorSubscribeIsolationTest {

    private static final Metadata.Key<String> TENANT_HEADER =
            Metadata.Key.of("x-tenant", Metadata.ASCII_STRING_MARSHALLER);

    /** Subscribe never routes through pool(): a registry that refuses it proves the subscribe path is independent. */
    private final TenantPoolRegistry registry = new TenantPoolRegistry() {
        @Override
        public ResourcePool poolFor(String tenantId) {
            throw new UnsupportedOperationException("subscribe must not resolve a pool");
        }

        @Override
        public void onboard(String tenantId) {
            throw new UnsupportedOperationException();
        }
    };

    /** The one broadcaster wired into both the service (subscription registry) and the per-tenant emit views. */
    private final EventBroadcaster broadcaster = new EventBroadcaster();

    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorStub asyncStub;

    /** Sets the gRPC context's tenant from the {@code x-tenant} header, standing in for the auth interceptor. */
    private static final ServerInterceptor TENANT_FROM_HEADER = new ServerInterceptor() {
        @Override
        public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
            io.grpc.Context context =
                    io.grpc.Context.current().withValue(TenantContext.TENANT_ID, headers.get(TENANT_HEADER));
            return Contexts.interceptCall(context, call, headers, next);
        }
    };

    /** subscribeEvents never routes through register()/report(), so any budget works here. */
    private final GlobalResourceBudget budget =
            new GlobalResourceBudget(new ReputationPoolProperties.Limits(1_000, 1_000));

    @BeforeEach
    void startServer() throws Exception {
        ReputationAdvisorService service = new ReputationAdvisorService(registry, broadcaster, budget);
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(ServerInterceptors.intercept(service, TENANT_FROM_HEADER))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        asyncStub = ReputationAdvisorGrpc.newStub(channel);
    }

    @AfterEach
    void stopServer() {
        channel.shutdownNow();
        server.shutdownNow();
    }

    private ReputationAdvisorGrpc.ReputationAdvisorStub asTenant(String tenantId) {
        Metadata md = new Metadata();
        md.put(TENANT_HEADER, tenantId);
        return asyncStub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    private static PoolEvent blocklistOf(String value) {
        return new PoolEvent.ResourceBlocklisted(new ResourceId(ResourceKind.PROXY, value), Instant.EPOCH, Instant.MAX);
    }

    @Test
    @DisplayName("테넌트 t1 컨텍스트로 구독하면 → t1 풀로 emit된 이벤트만 수신하고 t2 풀 이벤트는 받지 않는다")
    void subscriptionReceivesOnlyItsOwnTenantEvents() throws Exception {
        var received = new CopyOnWriteArrayList<io.github.preagile.reputationpool.grpc.v1.AdvisorProto.PoolEvent>();
        CountDownLatch got = new CountDownLatch(1);
        asTenant("t1").subscribeEvents(SubscribeEventsRequest.getDefaultInstance(), new StreamObserver<>() {
            @Override
            public void onNext(io.github.preagile.reputationpool.grpc.v1.AdvisorProto.PoolEvent value) {
                received.add(value);
                got.countDown();
            }

            @Override
            public void onError(Throwable t) {}

            @Override
            public void onCompleted() {}
        });

        // Wait until the subscription is registered before emitting (directExecutor makes delivery synchronous).
        for (int i = 0; i < 100 && broadcaster.subscriberCount() == 0; i++) {
            Thread.sleep(10);
        }
        assertThat(broadcaster.subscriberCount()).isEqualTo(1);

        // Emit to t2 first (must never reach t1's subscriber), then to t1 (must).
        broadcaster.forPool("t2").emit(blocklistOf("other"));
        broadcaster.forPool("t1").emit(blocklistOf("mine"));

        assertThat(got.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(received).hasSize(1); // t2's event did not leak across the tenant boundary
        assertThat(received.get(0).getEventCase()).isEqualTo(EventCase.BLOCKLISTED);
        assertThat(received.get(0).getBlocklisted().getResource().getValue()).isEqualTo("mine");
    }

    @Test
    @DisplayName("인증 테넌트 없이 구독하면 → subscriptionPoolId 가드가 걸려 스트림이 에러로 종료된다")
    void unauthenticatedSubscriptionFails() throws Exception {
        AtomicReference<Throwable> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        // No x-tenant header → the context tenant is null → subscriptionPoolId() throws before registration.
        asyncStub.subscribeEvents(SubscribeEventsRequest.getDefaultInstance(), new StreamObserver<>() {
            @Override
            public void onNext(io.github.preagile.reputationpool.grpc.v1.AdvisorProto.PoolEvent value) {}

            @Override
            public void onError(Throwable t) {
                error.set(t);
                done.countDown();
            }

            @Override
            public void onCompleted() {
                done.countDown();
            }
        });

        assertThat(done.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(error.get()).isNotNull();
        assertThat(broadcaster.subscriberCount()).isZero(); // never registered
    }
}
