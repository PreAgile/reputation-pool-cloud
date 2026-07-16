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
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Docker-free in-process test of the API-key gRPC interceptor over its {@link TenantResolver} seam. A
 * key that resolves to a tenant passes through to the service; a missing, unknown, or (fail-closed)
 * unseeded key is rejected with {@code UNAUTHENTICATED}; a resolver outage yields {@code UNAVAILABLE}.
 * Runs in the {@code build} gate.
 */
class ApiKeyAuthInterceptorTest {

    private static final String VALID_KEY = "secret-key";
    private static final String TENANT = "acme";
    private static final Metadata.Key<String> API_KEY = Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER);

    /** Resolves only VALID_KEY, to TENANT — the "one seeded key" case. */
    private static final TenantResolver ONE_KEY =
            keyHash -> Arrays.equals(keyHash, ApiKeyHashing.sha256(VALID_KEY)) ? Optional.of(TENANT) : Optional.empty();

    /** Resolves nothing — the fail-closed case (no key seeded / empty api_key table). */
    private static final TenantResolver NONE = keyHash -> Optional.empty();

    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub;

    private void startServerWith(TenantResolver resolver) throws Exception {
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
                .addService(ServerInterceptors.intercept(service, new ApiKeyAuthInterceptor(resolver)))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        stub = ReputationAdvisorGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void stopServer() {
        if (channel != null) {
            channel.shutdownNow();
        }
        if (server != null) {
            server.shutdownNow();
        }
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

    private static Status.Code codeOf(Throwable t) {
        return ((StatusRuntimeException) t).getStatus().getCode();
    }

    @Test
    void resolvableKey_passesThroughToTheService() throws Exception {
        startServerWith(ONE_KEY);
        withKey(VALID_KEY).register(registerProxy());

        var response = withKey(VALID_KEY)
                .acquire(AcquireRequest.newBuilder()
                        .setContext(Context.newBuilder().setValue("scrape"))
                        .build());

        assertThat(response.getGranted()).isTrue();
    }

    @Test
    void missingKey_isRejectedWithUnauthenticated() throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> stub.register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    @Test
    void unknownKey_isRejectedWithUnauthenticated() throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> withKey("nope").register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** Fail closed: with nothing seeded (resolver resolves nothing), even a plausible key is rejected. */
    @Test
    void noKeySeeded_rejectsEvenPlausibleKey() throws Exception {
        startServerWith(NONE);
        assertThatThrownBy(() -> withKey(VALID_KEY).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** A blank header is rejected before any resolver lookup. */
    @ParameterizedTest
    @ValueSource(strings = {"", " "})
    void blankKey_isRejectedWithUnauthenticated(String blank) throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> withKey(blank).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** A resolver outage is surfaced as UNAVAILABLE, not a false UNAUTHENTICATED. */
    @Test
    void resolverOutage_isRejectedWithUnavailable() throws Exception {
        startServerWith(keyHash -> {
            throw new IllegalStateException("db down");
        });
        assertThatThrownBy(() -> withKey(VALID_KEY).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAVAILABLE));
    }
}
