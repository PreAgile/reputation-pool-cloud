package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.ReputationAdvisorService;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Docker-free in-process test of the API-key gRPC interceptor: a valid key passes through to the
 * service, a missing or wrong key is rejected with {@code UNAUTHENTICATED}. Runs in the {@code build}
 * gate.
 */
class ApiKeyAuthInterceptorTest {

    private static final String VALID_KEY = "secret-key";
    private static final Metadata.Key<String> API_KEY = Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER);

    private Server server;
    private io.grpc.ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub;

    @BeforeEach
    void startServer() throws Exception {
        Clock clock = Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);
        ResourcePool pool = new ResourcePool(
                new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                new WeightedRandomSelectionStrategy(),
                new EventBroadcaster(),
                clock,
                new Random(42),
                Duration.ofSeconds(30));
        ReputationAdvisorService service = new ReputationAdvisorService(pool, new EventBroadcaster());
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(ServerInterceptors.intercept(service, new ApiKeyAuthInterceptor(VALID_KEY)))
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

    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub withKey(String key) {
        Metadata md = new Metadata();
        md.put(API_KEY, key);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    private static RegisterRequest registerProxy() {
        return RegisterRequest.newBuilder()
                .setResource(ResourceId.newBuilder().setKind(ResourceKind.PROXY).setValue("p1"))
                .build();
    }

    @Test
    void validKey_passesThroughToTheService() {
        withKey(VALID_KEY).register(registerProxy());

        var response = withKey(VALID_KEY)
                .acquire(AcquireRequest.newBuilder()
                        .setContext(Context.newBuilder().setValue("scrape"))
                        .build());

        assertThat(response.getGranted()).isTrue();
    }

    @Test
    void missingKey_isRejectedWithUnauthenticated() {
        assertThatThrownBy(() -> stub.register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(io.grpc.Status.Code.UNAUTHENTICATED));
    }

    @Test
    void wrongKey_isRejectedWithUnauthenticated() {
        assertThatThrownBy(() -> withKey("nope").register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(io.grpc.Status.Code.UNAUTHENTICATED));
    }
}
