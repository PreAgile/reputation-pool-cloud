package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.domain.Blocklist;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Outcome;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
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
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The gRPC-level slice test for the shared-JVM global resource budget (issue #84): cloud's {@code
 * register()}/{@code report()} overrides on {@link ReputationAdvisorService} must refuse a call that
 * would create a genuinely new resource/cell once the process-wide {@link GlobalResourceBudget} is
 * exhausted — with {@code RESOURCE_EXHAUSTED}, never delegating to core — while a call that only touches
 * an already-known resource/cell must pass through even when the budget has nothing left, since it
 * creates nothing new.
 *
 * <p>Each test mocks the tenant's {@link ResourcePool} so it can assert exactly what {@link
 * #register}/{@link #report} on the base class did or did not receive (the true seam under test — the
 * budget arithmetic itself is {@link io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudgetTest}'s
 * job). Docker-free (in-process transport), runs in the {@code build} gate.
 */
@DisplayName("ReputationAdvisorService(global budget): 프로세스 전역 예산을 넘는 신규 등록/셀 생성만 RESOURCE_EXHAUSTED 로 거부한다")
class AdvisorGlobalBudgetTest {

    private static final Metadata.Key<String> TENANT_HEADER =
            Metadata.Key.of("x-tenant", Metadata.ASCII_STRING_MARSHALLER);

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

    private void startServerWith(TenantPoolRegistry registry, GlobalResourceBudget budget) throws Exception {
        ReputationAdvisorService service = new ReputationAdvisorService(registry, new EventBroadcaster(), budget);
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(ServerInterceptors.intercept(service, TENANT_FROM_HEADER))
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

    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub asTenant(String tenantId) {
        Metadata md = new Metadata();
        md.put(TENANT_HEADER, tenantId);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    private static io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId protoResource(String value) {
        return io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId.newBuilder()
                .setKind(io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind.PROXY)
                .setValue(value)
                .build();
    }

    private static io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context protoContext(String value) {
        return io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context.newBuilder()
                .setValue(value)
                .build();
    }

    /** A pool whose snapshot has no registered resources and no cells — everything looks brand new. */
    private static ResourcePool emptyPoolMock() {
        ResourcePool pool = mock(ResourcePool.class);
        when(pool.snapshot()).thenReturn(new PoolSnapshot(Map.of(), Blocklist.empty(), Set.of()));
        return pool;
    }

    private static TenantPoolRegistry singleTenantRegistry(String tenantId, ResourcePool pool) {
        return new TenantPoolRegistry() {
            @Override
            public ResourcePool poolFor(String id) {
                assertThat(id).isEqualTo(tenantId);
                return pool;
            }

            @Override
            public void onboard(String id) {}
        };
    }

    @Test
    @DisplayName("전역 리소스 예산이 남아있으면 → register 가 core 로 위임되어 정상 등록된다")
    void registerWithinBudgetDelegatesToCore() throws Exception {
        ResourcePool pool = emptyPoolMock();
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .build());

        verify(pool, times(1)).register(new ResourceId(ResourceKind.PROXY, "p1"));
        assertThat(budget.resourceCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("전역 리소스 예산을 이미 소진했으면 → 새 리소스 register 는 RESOURCE_EXHAUSTED 로 거부되고 core register 는 호출되지 않는다")
    void registerBeyondBudgetIsRejectedWithoutCallingCore() throws Exception {
        ResourcePool pool = emptyPoolMock();
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        // 1번째 리소스는 예산(1)을 정확히 소진한다.
        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .build());

        // 2번째 신규 리소스는 전역 예산이 바닥나 core 를 타지 않고 거부되어야 한다.
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .register(RegisterRequest.newBuilder()
                                .setResource(protoResource("p2"))
                                .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(Status.Code.RESOURCE_EXHAUSTED));

        verify(pool, never()).register(new ResourceId(ResourceKind.PROXY, "p2"));
        verify(pool, times(1)).register(any());
    }

    @Test
    @DisplayName("이미 등록된 리소스를 재등록하면 → 예산이 바닥나도 core register 로 위임되고 카운터는 늘지 않는다")
    void reRegisteringAnAlreadyRegisteredResourceBypassesTheExhaustedBudget() throws Exception {
        ResourceId existing = new ResourceId(ResourceKind.PROXY, "p1");
        ResourcePool pool = mock(ResourcePool.class);
        // 이 리소스는 이미 등록되어 있는 상태로 스냅샷을 스텁한다 — 재등록은 "신규"가 아니다.
        when(pool.snapshot()).thenReturn(new PoolSnapshot(Map.of(), Blocklist.empty(), Set.of(existing)));
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        budget.tryReserveResource(); // 예산을 미리 다 소진시켜 둔다 (다른 리소스로 이미 가득 찬 상태를 흉내)
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .build());

        verify(pool, times(1)).register(existing);
        assertThat(budget.resourceCount()).isEqualTo(1); // 재등록으로 카운터가 중복 증가하지 않았다
    }

    @Test
    @DisplayName("전역 셀 예산이 남아있으면 → report 가 core 로 위임되어 정상 기록된다")
    void reportWithinBudgetDelegatesToCore() throws Exception {
        ResourcePool pool = emptyPoolMock();
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        asTenant("tenant-a")
                .report(ReportRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .setContext(protoContext("scrape"))
                        .setOutcome(Outcome.newBuilder().setSuccess(Outcome.Success.getDefaultInstance()))
                        .build());

        verify(pool, times(1))
                .report(
                        new ResourceId(ResourceKind.PROXY, "p1"),
                        new Context("scrape"),
                        new io.github.preagile.reputationpool.core.domain.Outcome.Success(java.time.Duration.ZERO));
        assertThat(budget.cellCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("전역 셀 예산을 이미 소진했으면 → 새 (리소스,컨텍스트) 조합의 report 는 RESOURCE_EXHAUSTED 로 거부되고 core report 는 호출되지 않는다")
    void reportBeyondCellBudgetIsRejectedWithoutCallingCore() throws Exception {
        ResourcePool pool = emptyPoolMock();
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        // 1번째 (리소스, 컨텍스트) 조합이 셀 예산(1)을 정확히 소진한다.
        asTenant("tenant-a")
                .report(ReportRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .setContext(protoContext("scrape"))
                        .setOutcome(Outcome.newBuilder().setSuccess(Outcome.Success.getDefaultInstance()))
                        .build());

        // 2번째: 다른 컨텍스트라 새 셀이지만, 전역 셀 예산이 바닥나 core 를 타지 않고 거부되어야 한다.
        assertThatThrownBy(() -> asTenant("tenant-a")
                        .report(ReportRequest.newBuilder()
                                .setResource(protoResource("p1"))
                                .setContext(protoContext("checkout"))
                                .setOutcome(Outcome.newBuilder().setSuccess(Outcome.Success.getDefaultInstance()))
                                .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(Status.Code.RESOURCE_EXHAUSTED));

        verify(pool, times(1)).report(any(), any(), any());
    }

    @Test
    @DisplayName("이미 존재하는 셀에 재보고하면 → 셀 예산이 바닥나도 core report 로 위임되고 카운터는 늘지 않는다")
    void reportingAnExistingCellBypassesTheExhaustedCellBudget() throws Exception {
        ResourceId resource = new ResourceId(ResourceKind.PROXY, "p1");
        Context context = new Context("scrape");
        CellKey existingCell = new CellKey(resource, context);
        ResourcePool pool = mock(ResourcePool.class);
        when(pool.snapshot())
                .thenReturn(new PoolSnapshot(
                        Map.of(existingCell, ReputationCell.fresh(resource, context, Instant.EPOCH)),
                        Blocklist.empty(),
                        Set.of()));
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        budget.tryReserveCell(); // 다른 셀로 예산이 이미 가득 찬 상태를 흉내
        startServerWith(singleTenantRegistry("tenant-a", pool), budget);

        asTenant("tenant-a")
                .report(ReportRequest.newBuilder()
                        .setResource(protoResource("p1"))
                        .setContext(protoContext("scrape"))
                        .setOutcome(Outcome.newBuilder().setSuccess(Outcome.Success.getDefaultInstance()))
                        .build());

        verify(pool, times(1))
                .report(
                        resource,
                        context,
                        new io.github.preagile.reputationpool.core.domain.Outcome.Success(java.time.Duration.ZERO));
        assertThat(budget.cellCount()).isEqualTo(1); // 기존 셀 재보고로 카운터가 중복 증가하지 않았다
    }

    @Test
    @DisplayName("서로 다른 테넌트라도 → 하나의 전역 예산을 공유하므로 두 테넌트 합계가 예산을 넘으면 거부된다")
    void differentTenantsShareTheSameGlobalResourceBudget() throws Exception {
        ResourcePool poolA = emptyPoolMock();
        ResourcePool poolB = emptyPoolMock();
        GlobalResourceBudget budget = new GlobalResourceBudget(new ReputationPoolProperties.Limits(1, 1));
        TenantPoolRegistry registry = new TenantPoolRegistry() {
            @Override
            public ResourcePool poolFor(String tenantId) {
                return "tenant-a".equals(tenantId) ? poolA : poolB;
            }

            @Override
            public void onboard(String tenantId) {}
        };
        startServerWith(registry, budget);

        // 테넌트 A가 전역 예산 1개를 전부 쓴다.
        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder()
                        .setResource(protoResource("a1"))
                        .build());

        // 테넌트 B는 자기 풀은 비어 있지만(스냅샷상 신규), 전역 예산이 A 때문에 바닥나 거부된다.
        assertThatThrownBy(() -> asTenant("tenant-b")
                        .register(RegisterRequest.newBuilder()
                                .setResource(protoResource("b1"))
                                .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(
                        e -> assertThat(((StatusRuntimeException) e).getStatus().getCode())
                                .isEqualTo(Status.Code.RESOURCE_EXHAUSTED));

        verify(poolB, never()).register(any());
    }
}
