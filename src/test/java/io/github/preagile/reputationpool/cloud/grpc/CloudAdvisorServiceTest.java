package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Verifies cloud's thin {@code @GrpcService} subclass delegates correctly to the shared
 * reputation-pool-grpc handler. The RPC semantics themselves are covered by the grpc module's own
 * contract test; this only proves cloud's registration + constructor wiring is sound. Docker-free
 * (in-process transport, in-memory pool), so it runs in the {@code build} gate.
 */
class CloudAdvisorServiceTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);

    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub;

    @BeforeEach
    void startServer() throws Exception {
        ResourcePool pool = new ResourcePool(
                new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                new WeightedRandomSelectionStrategy(),
                new EventBroadcaster(),
                clock,
                new Random(42),
                Duration.ofSeconds(30));
        // The class under test: cloud's @GrpcService subclass, exercised over real gRPC wiring.
        ReputationAdvisorService service = new ReputationAdvisorService(pool, new EventBroadcaster());
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(service)
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        stub = ReputationAdvisorGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void stopServer() {
        channel.shutdownNow();
        server.shutdownNow();
    }

    @Test
    void register_thenAcquire_grantsALease() {
        ResourceId proxy = ResourceId.newBuilder()
                .setKind(ResourceKind.PROXY)
                .setValue("p1")
                .build();
        stub.register(RegisterRequest.newBuilder().setResource(proxy).build());

        AcquireResponse response = stub.acquire(AcquireRequest.newBuilder()
                .setContext(Context.newBuilder().setValue("scrape"))
                .build());

        assertThat(response.getGranted()).isTrue();
        assertThat(response.getLease().getResource()).isEqualTo(proxy);
    }

    @Test
    void acquire_onEmptyPool_isNotGranted() {
        AcquireResponse response = stub.acquire(AcquireRequest.newBuilder()
                .setContext(Context.newBuilder().setValue("scrape"))
                .build());

        assertThat(response.getGranted()).isFalse();
    }
}
