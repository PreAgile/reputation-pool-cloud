package io.github.preagile.reputationpool.cloud.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.tenant.TenantContext;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.LeaseHandle;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RenewRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RenewResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The isolation penetration test: two tenants share one in-process gRPC server, and each call is routed
 * to the caller's tenant pool by cloud's {@code pool()} override reading {@link TenantContext#TENANT_ID}.
 * It proves the core #9b guarantee at the gRPC surface — a resource registered by tenant A is invisible
 * to tenant B: B cannot acquire it, and B cannot renew A's lease. Docker-free (in-process transport,
 * in-memory per-tenant pools), so it runs in the {@code build} gate.
 */
@DisplayName("ReputationAdvisorService: 요청을 호출자의 테넌트 풀로 라우팅해 테넌트 간 리소스·리스를 격리하는 gRPC 어드바이저")
class CloudAdvisorServiceTest {

    private static final Metadata.Key<String> TENANT_HEADER =
            Metadata.Key.of("x-tenant", Metadata.ASCII_STRING_MARSHALLER);

    private final Clock clock = Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);

    /** One in-memory pool per tenant — the same lazy-per-tenant shape as PerTenantPoolRegistry. */
    private final TenantPoolRegistry registry = new TenantPoolRegistry() {
        private final ConcurrentHashMap<String, ResourcePool> pools = new ConcurrentHashMap<>();

        @Override
        public ResourcePool poolFor(String tenantId) {
            return pools.computeIfAbsent(
                    tenantId,
                    id -> new ResourcePool(
                            new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                            new WeightedRandomSelectionStrategy(),
                            new EventBroadcaster(),
                            clock,
                            new Random(42),
                            Duration.ofSeconds(30)));
        }

        @Override
        public void onboard(String tenantId) {
            poolFor(tenantId);
        }

        @Override
        public void evict(String tenantId) {
            pools.remove(tenantId);
        }
    };

    private Server server;
    private ManagedChannel channel;
    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub;

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

    @BeforeEach
    void startServer() throws Exception {
        ReputationAdvisorService service = new ReputationAdvisorService(registry, new EventBroadcaster());
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
        channel.shutdownNow();
        server.shutdownNow();
    }

    private ReputationAdvisorGrpc.ReputationAdvisorBlockingStub asTenant(String tenantId) {
        Metadata md = new Metadata();
        md.put(TENANT_HEADER, tenantId);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    private static AcquireRequest acquireScrape() {
        return AcquireRequest.newBuilder()
                .setContext(Context.newBuilder().setValue("scrape"))
                .build();
    }

    @Test
    @DisplayName("한 테넌트가 등록한 리소스는 → 그 테넌트만 리스할 수 있고, 다른 테넌트의 풀에는 보이지 않아 리스가 거절된다")
    void resourceRegisteredByOneTenantIsInvisibleToAnother() {
        ResourceId proxy = ResourceId.newBuilder()
                .setKind(ResourceKind.PROXY)
                .setValue("p1")
                .build();
        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder().setResource(proxy).build());

        // Tenant A sees and can lease its own resource.
        AcquireResponse aAcquired = asTenant("tenant-a").acquire(acquireScrape());
        assertThat(aAcquired.getGranted()).isTrue();
        assertThat(aAcquired.getLease().getResource()).isEqualTo(proxy);

        // Tenant B's pool is empty — A's resource does not leak across the tenant boundary.
        AcquireResponse bAcquired = asTenant("tenant-b").acquire(acquireScrape());
        assertThat(bAcquired.getGranted()).isFalse();
    }

    @Test
    @DisplayName("다른 테넌트가 발급받은 리스를 넘겨 갱신을 시도하면 → 내 리스 레지스트리에 없으므로 갱신이 거절된다")
    void oneTenantCannotRenewAnothersLease() {
        ResourceId proxy = ResourceId.newBuilder()
                .setKind(ResourceKind.PROXY)
                .setValue("p1")
                .build();
        asTenant("tenant-a")
                .register(RegisterRequest.newBuilder().setResource(proxy).build());
        LeaseHandle aLease = asTenant("tenant-a").acquire(acquireScrape()).getLease();

        // Tenant B does not hold this lease in its own lease registry, so the renew is refused.
        RenewResponse bRenew = asTenant("tenant-b")
                .renew(RenewRequest.newBuilder().setLease(aLease).build());

        assertThat(bRenew.getRenewed()).isFalse();
    }
}
