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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Docker-free in-process test of the API-key gRPC interceptor over its {@link TenantResolver} seam. A
 * key that resolves to a tenant passes through to the service; a missing, unknown, or (fail-closed)
 * unseeded key is rejected with {@code UNAUTHENTICATED}; a resolver outage yields {@code UNAVAILABLE}.
 * Runs in the {@code build} gate.
 */
@DisplayName("ApiKeyAuthInterceptor: x-api-key 를 테넌트로 해석해 gRPC 호출을 인증/거부하는 인터셉터")
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
    @DisplayName("테넌트로 해석되는 유효한 키를 실으면 → 서비스까지 통과해 정상 응답(granted=true)을 받는다")
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
    @DisplayName("x-api-key 헤더 자체가 없으면 → UNAUTHENTICATED 로 거부한다")
    void missingKey_isRejectedWithUnauthenticated() throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> stub.register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    @Test
    @DisplayName("어떤 테넌트로도 해석되지 않는 키면 → UNAUTHENTICATED 로 거부한다")
    void unknownKey_isRejectedWithUnauthenticated() throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> withKey("nope").register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** Fail closed: with nothing seeded (resolver resolves nothing), even a plausible key is rejected. */
    @Test
    @DisplayName("시드된 키가 하나도 없으면(fail-closed) → 그럴듯한 키라도 UNAUTHENTICATED 로 거부한다")
    void noKeySeeded_rejectsEvenPlausibleKey() throws Exception {
        startServerWith(NONE);
        assertThatThrownBy(() -> withKey(VALID_KEY).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** A blank header is rejected before any resolver lookup. */
    @ParameterizedTest
    @ValueSource(strings = {"", " "})
    @DisplayName("빈 문자열/공백 키면 → 리졸버 조회 이전에 UNAUTHENTICATED 로 거부한다")
    void blankKey_isRejectedWithUnauthenticated(String blank) throws Exception {
        startServerWith(ONE_KEY);
        assertThatThrownBy(() -> withKey(blank).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    /** A resolver outage is surfaced as UNAVAILABLE, not a false UNAUTHENTICATED. */
    @Test
    @DisplayName("리졸버가 예외로 장애 상태면 → 오인 거부(UNAUTHENTICATED)가 아니라 UNAVAILABLE 로 응답한다")
    void resolverOutage_isRejectedWithUnavailable() throws Exception {
        startServerWith(keyHash -> {
            throw new IllegalStateException("db down");
        });
        assertThatThrownBy(() -> withKey(VALID_KEY).register(registerProxy()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(e -> assertThat(codeOf(e)).isEqualTo(Status.Code.UNAVAILABLE));
    }
}
