package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Counts;
import io.github.preagile.reputationpool.cloud.metering.OutcomeRecorder.Key;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.domain.Blocklist;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Outcome;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportRequest;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.Contexts;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.ServerInterceptors;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The gRPC-level slice test for per-context outcome counting (issue #189). Cloud's {@code report()}
 * override is the only place in the system where <em>every</em> report is visible — the engine's score
 * cannot be inverted into a ratio and the audit trail records only transitions — so this pins down exactly
 * which calls become counts and which do not.
 *
 * <p>The pool is mocked and the clock fixed, so the assertions are about the recorder alone (the
 * accumulate/drain arithmetic itself is {@code OutcomeRecorderTest}'s job). Docker-free (in-process
 * transport), runs in the {@code build} gate.
 */
@DisplayName("ReputationAdvisorService(outcome): report 경계를 통과한 보고만 컨텍스트별 성공/실패 카운터에 실린다")
class AdvisorOutcomeCountingTest {

    private static final Metadata.Key<String> TENANT_HEADER =
            Metadata.Key.of("x-tenant", Metadata.ASCII_STRING_MARSHALLER);

    /** 10:42 로 고정 — 버킷은 10:00 으로 잘려야 한다(플러시 시각이 아니라 보고 시각이 버킷을 정한다). */
    private static final Instant NOW = Instant.parse("2026-08-12T10:42:31Z");

    private static final Instant BUCKET = Instant.parse("2026-08-12T10:00:00Z");

    private final OutcomeRecorder recorder = new OutcomeRecorder();

    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub;

    private static final ServerInterceptor TENANT_FROM_HEADER = new ServerInterceptor() {
        @Override
        public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
            io.grpc.Context context =
                    io.grpc.Context.current().withValue(TenantContext.TENANT_ID, headers.get(TENANT_HEADER));
            return Contexts.interceptCall(context, call, headers, next);
        }
    };

    /** A pool whose snapshot is empty, so every report looks like a brand new cell to the budget gate. */
    private static ResourcePool emptyPoolMock() {
        ResourcePool pool = mock(ResourcePool.class);
        when(pool.snapshot()).thenReturn(new PoolSnapshot(Map.of(), Blocklist.empty(), Set.of()));
        return pool;
    }

    private static TenantPoolRegistry registryOf(ResourcePool pool) {
        return new TenantPoolRegistry() {
            @Override
            public ResourcePool poolFor(String tenantId) {
                return pool;
            }

            @Override
            public void onboard(String tenantId) {}

            @Override
            public void evict(String tenantId) {}
        };
    }

    private void startServerWith(GlobalResourceBudget budget) throws Exception {
        ReputationAdvisorService service = new ReputationAdvisorService(
                registryOf(emptyPoolMock()),
                new EventBroadcaster(),
                budget,
                recorder,
                Clock.fixed(NOW, ZoneOffset.UTC));
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(ServerInterceptors.intercept(service, TENANT_FROM_HEADER))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        stub = ReputationAdvisorGrpc.newBlockingStub(channel);
    }

    @BeforeEach
    void startServer() throws Exception {
        startServerWith(new GlobalResourceBudget(new ReputationPoolProperties.Limits(1_000, 1_000)));
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

    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub asTenant(String tenantId) {
        Metadata md = new Metadata();
        md.put(TENANT_HEADER, tenantId);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    private static AdvisorProto.ResourceId protoResource(AdvisorProto.ResourceKind kind, String value) {
        return AdvisorProto.ResourceId.newBuilder()
                .setKind(kind)
                .setValue(value)
                .build();
    }

    private static ReportRequest report(AdvisorProto.ResourceKind kind, String context, Outcome outcome) {
        return ReportRequest.newBuilder()
                .setResource(protoResource(kind, "p1"))
                .setContext(AdvisorProto.Context.newBuilder().setValue(context))
                .setOutcome(outcome)
                .build();
    }

    private static Outcome success() {
        return Outcome.newBuilder()
                .setSuccess(Outcome.Success.getDefaultInstance())
                .build();
    }

    private static Outcome failure(AdvisorProto.FailureType type) {
        return Outcome.newBuilder()
                .setFailure(Outcome.Failure.newBuilder().setType(type))
                .build();
    }

    private static Outcome successWithLatency(long seconds) {
        return Outcome.newBuilder()
                .setSuccess(Outcome.Success.newBuilder().setLatency(protoSeconds(seconds)))
                .build();
    }

    private static Outcome failureWithLatency(AdvisorProto.FailureType type, long seconds) {
        return Outcome.newBuilder()
                .setFailure(Outcome.Failure.newBuilder().setType(type).setLatency(protoSeconds(seconds)))
                .build();
    }

    private static com.google.protobuf.Duration protoSeconds(long seconds) {
        return com.google.protobuf.Duration.newBuilder().setSeconds(seconds).build();
    }

    private Counts countsFor(String tenantId, String context, ResourceKind kind) {
        return recorder.drain(BUCKET).get(new Key(tenantId, context, kind, BUCKET));
    }

    @Test
    @DisplayName("성공 2건과 BLOCKED 1건을 같은 컨텍스트로 보고하면 → 그 컨텍스트 버킷에 성공 2·BLOCKED 1 이 실린다")
    void successesAndFailuresAreCountedPerContext() {
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));
        asTenant("tenant-a")
                .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.BLOCKED)));

        Counts counts = countsFor("tenant-a", "scrape", ResourceKind.PROXY);
        assertThat(counts.success()).isEqualTo(2);
        assertThat(counts.failureCount(FailureType.BLOCKED)).isEqualTo(1);
        assertThat(counts.total()).isEqualTo(3);
    }

    @Test
    @DisplayName("실패 종류를 섞어 보고하면 → 하나의 실패 합계가 아니라 종류별로 나뉘어 집계된다")
    void failuresAreBrokenDownByType() {
        asTenant("tenant-a")
                .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.BLOCKED)));
        asTenant("tenant-a")
                .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.BLOCKED)));
        asTenant("tenant-a")
                .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.TIMEOUT)));
        asTenant("tenant-a")
                .report(report(
                        AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.TLS_HANDSHAKE)));

        Counts counts = countsFor("tenant-a", "scrape", ResourceKind.PROXY);
        assertThat(counts.success()).isZero();
        assertThat(counts.failureCount(FailureType.BLOCKED)).isEqualTo(2);
        assertThat(counts.failureCount(FailureType.TIMEOUT)).isEqualTo(1);
        assertThat(counts.failureCount(FailureType.TLS_HANDSHAKE)).isEqualTo(1);
        assertThat(counts.failureCount(FailureType.SLOW)).isZero();
        assertThat(counts.failureCount(FailureType.CONNECTION_RESET)).isZero();
    }

    @Test
    @DisplayName("리소스 종류가 다르면 → 같은 컨텍스트라도 PROXY·ACCOUNT 버킷으로 나뉜다(저장 입도가 컨텍스트+종류이므로)")
    void bucketsAreSeparatedByResourceKind() {
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.ACCOUNT, "scrape", success()));

        Map<Key, Counts> drained = recorder.drain(BUCKET);
        assertThat(drained).hasSize(2);
        assertThat(drained.get(new Key("tenant-a", "scrape", ResourceKind.PROXY, BUCKET))
                        .success())
                .isEqualTo(1);
        assertThat(drained.get(new Key("tenant-a", "scrape", ResourceKind.ACCOUNT, BUCKET))
                        .success())
                .isEqualTo(1);
    }

    @Test
    @DisplayName("서로 다른 테넌트가 같은 컨텍스트로 보고하면 → 테넌트별로 분리 집계되어 한쪽 성공률이 다른 쪽에 섞이지 않는다")
    void countsAreScopedToTheAuthenticatedTenant() {
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));
        asTenant("tenant-b")
                .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", failure(AdvisorProto.FailureType.BLOCKED)));

        Map<Key, Counts> drained = recorder.drain(BUCKET);
        assertThat(drained.get(new Key("tenant-a", "scrape", ResourceKind.PROXY, BUCKET))
                        .success())
                .isEqualTo(1);
        assertThat(drained.get(new Key("tenant-a", "scrape", ResourceKind.PROXY, BUCKET))
                        .failureCount(FailureType.BLOCKED))
                .isZero();
        assertThat(drained.get(new Key("tenant-b", "scrape", ResourceKind.PROXY, BUCKET))
                        .failureCount(FailureType.BLOCKED))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("보고 시각이 10:42 여도 → 버킷은 10:00 으로 잘려 그 시간대에 누적된다")
    void theBucketIsTheReportHourNotTheFlushHour() {
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));

        Map<Key, Counts> drained = recorder.drain(BUCKET);
        assertThat(drained).containsOnlyKeys(new Key("tenant-a", "scrape", ResourceKind.PROXY, BUCKET));
    }

    @Test
    @DisplayName("결과 종류를 비운 보고는 → core 의 디코드가 거절하므로 성공률 분모에도 들어가지 않는다")
    void anOutcomeWithNoKindIsNotCounted() {
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", Outcome.getDefaultInstance())))
                .isInstanceOf(StatusRuntimeException.class);

        assertThat(recorder.drain(BUCKET)).isEmpty();
    }

    @Test
    @DisplayName("실패 종류를 UNSPECIFIED 로 보낸 보고는 → core 가 거절하므로 실패로도 성공으로도 세지 않는다")
    void anUnspecifiedFailureTypeIsNotCounted() {
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .report(report(
                                AdvisorProto.ResourceKind.PROXY,
                                "scrape",
                                failure(AdvisorProto.FailureType.FAILURE_TYPE_UNSPECIFIED))))
                .isInstanceOf(StatusRuntimeException.class);

        assertThat(recorder.drain(BUCKET)).isEmpty();
    }

    @Test
    @DisplayName("latency 가 음수인 성공 보고는 → core 의 Outcome 생성자가 거절하므로 성공으로 세지 않는다")
    void aNegativeLatencySuccessIsNotCounted() {
        // 이 거절은 와이어에 보이지 않는다 — kind 도 실패 종류도 멀쩡하고, Outcome.Success 생성자만 안다.
        // 카운트 게이트가 규칙을 따로 적어 두면 여기서 core 와 어긋나 엔진에 닿지 않은 보고가 분모에 들어간다.
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .report(report(AdvisorProto.ResourceKind.PROXY, "scrape", successWithLatency(-1))))
                .isInstanceOf(StatusRuntimeException.class);

        assertThat(recorder.drain(BUCKET)).isEmpty();
    }

    @Test
    @DisplayName("latency 가 음수인 실패 보고는 → 같은 이유로 실패 분자에도 들어가지 않는다")
    void aNegativeLatencyFailureIsNotCounted() {
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .report(report(
                                AdvisorProto.ResourceKind.PROXY,
                                "scrape",
                                failureWithLatency(AdvisorProto.FailureType.BLOCKED, -1))))
                .isInstanceOf(StatusRuntimeException.class);

        assertThat(recorder.drain(BUCKET)).isEmpty();
    }

    @Test
    @DisplayName("latency 가 0 이상인 성공 보고는 → 정상적으로 엔진에 닿고 성공으로 세진다(경계값 0)")
    void aZeroLatencySuccessIsCounted() {
        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", successWithLatency(0)));

        assertThat(countsFor("tenant-a", "scrape", ResourceKind.PROXY).success())
                .isEqualTo(1);
    }

    @Test
    @DisplayName("전역 셀 예산이 바닥나 RESOURCE_EXHAUSTED 로 거부된 보고는 → 엔진에 닿지 않았으므로 카운트되지 않는다")
    void aBudgetRefusedReportIsNotCounted() throws Exception {
        stopServer();
        // 예산 1을 첫 보고가 정확히 소진하고, 두 번째(다른 컨텍스트 = 새 셀)는 거부된다.
        startServerWith(new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1)));

        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "scrape", success()));
        assertThatThrownBy(() ->
                        asTenant("tenant-a").report(report(AdvisorProto.ResourceKind.PROXY, "checkout", success())))
                .isInstanceOf(StatusRuntimeException.class);

        Map<Key, Counts> drained = recorder.drain(BUCKET);
        assertThat(drained).containsOnlyKeys(new Key("tenant-a", "scrape", ResourceKind.PROXY, BUCKET));
    }
}
