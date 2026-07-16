package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.protobuf.Duration;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Outcome;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.PoolEvent;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReleaseRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RenewRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RenewResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.SubscribeEventsRequest;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * In-process contract test for the gRPC service: rides the real gRPC wiring (generated stubs, the
 * service, {@link ProtoMapping}, the {@link EventBroadcaster}) with no sockets, no ports, and no
 * database — the pool is an in-memory instance. Docker-free, so it runs in the {@code build} gate.
 */
class ReputationAdvisorServiceContractTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);

    private EventBroadcaster broadcaster;
    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub blockingStub;

    @BeforeEach
    void startServer() throws Exception {
        broadcaster = new EventBroadcaster();
        ResourcePool pool = new ResourcePool(
                new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                new WeightedRandomSelectionStrategy(),
                broadcaster,
                clock,
                new Random(42),
                java.time.Duration.ofSeconds(30));
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(new ReputationAdvisorService(pool, broadcaster))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        blockingStub = ReputationAdvisorGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void stopServer() {
        channel.shutdownNow();
        server.shutdownNow();
    }

    private static ResourceId proxy(String value) {
        return ResourceId.newBuilder()
                .setKind(ResourceKind.PROXY)
                .setValue(value)
                .build();
    }

    @Test
    void register_thenAcquire_grantsALeaseForARegisteredResource() {
        blockingStub.register(
                RegisterRequest.newBuilder().setResource(proxy("p1")).build());

        AcquireResponse response = blockingStub.acquire(
                AcquireRequest.newBuilder().setContext(ctx("scrape")).build());

        assertThat(response.getGranted()).isTrue();
        assertThat(response.getLease().getResource()).isEqualTo(proxy("p1"));
        assertThat(response.getLease().getToken()).isPositive();
    }

    @Test
    void acquire_onEmptyPool_isNotGranted() {
        AcquireResponse response = blockingStub.acquire(
                AcquireRequest.newBuilder().setContext(ctx("scrape")).build());

        assertThat(response.getGranted()).isFalse();
        assertThat(response.hasLease()).isFalse();
    }

    @Test
    void acquire_thenRenew_thenRelease_roundTrips() {
        blockingStub.register(
                RegisterRequest.newBuilder().setResource(proxy("p1")).build());
        AcquireResponse acquired = blockingStub.acquire(
                AcquireRequest.newBuilder().setContext(ctx("scrape")).build());

        RenewResponse renewed = blockingStub.renew(
                RenewRequest.newBuilder().setLease(acquired.getLease()).build());
        assertThat(renewed.getRenewed()).isTrue();

        var released = blockingStub.release(
                ReleaseRequest.newBuilder().setLease(renewed.getLease()).build());
        assertThat(released.getReleased()).isTrue();
    }

    @Test
    void report_isAccepted() {
        blockingStub.register(
                RegisterRequest.newBuilder().setResource(proxy("p1")).build());

        // A success report; the response is empty, the point is that it does not error.
        blockingStub.report(ReportRequest.newBuilder()
                .setResource(proxy("p1"))
                .setContext(ctx("scrape"))
                .setOutcome(Outcome.newBuilder()
                        .setSuccess(Outcome.Success.newBuilder()
                                .setLatency(Duration.newBuilder().setSeconds(1))))
                .build());
    }

    @Test
    void malformedRequest_isRejectedWithInvalidArgument() {
        // An unspecified resource kind is rejected by ProtoMapping at the boundary.
        assertThatThrownBy(() -> blockingStub.register(RegisterRequest.newBuilder()
                        .setResource(ResourceId.newBuilder().setValue("p1")) // kind defaults to UNSPECIFIED
                        .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void subscribeEvents_receivesAResourceLeasedEvent() throws Exception {
        List<PoolEvent> received = new CopyOnWriteArrayList<>();
        CountDownLatch gotEvent = new CountDownLatch(1);
        ReputationAdvisorGrpc.newStub(channel)
                .subscribeEvents(SubscribeEventsRequest.getDefaultInstance(), new StreamObserver<>() {
                    @Override
                    public void onNext(PoolEvent event) {
                        received.add(event);
                        gotEvent.countDown();
                    }

                    @Override
                    public void onError(Throwable t) {}

                    @Override
                    public void onCompleted() {}
                });

        // Wait until the subscription is registered server-side before triggering an event.
        for (int i = 0; i < 50 && broadcaster.subscriberCount() == 0; i++) {
            Thread.sleep(10);
        }
        assertThat(broadcaster.subscriberCount()).isEqualTo(1);

        // Acquiring a lease makes the pool emit a ResourceLeased event, which fans out to the stream.
        blockingStub.register(
                RegisterRequest.newBuilder().setResource(proxy("p1")).build());
        blockingStub.acquire(
                AcquireRequest.newBuilder().setContext(ctx("scrape")).build());

        assertThat(gotEvent.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(received).anyMatch(PoolEvent::hasLeased);
    }

    private static Context ctx(String value) {
        return Context.newBuilder().setValue(value).build();
    }
}
