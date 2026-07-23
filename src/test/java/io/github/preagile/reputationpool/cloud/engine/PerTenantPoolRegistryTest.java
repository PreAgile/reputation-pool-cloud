package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.metering.MeterRecorder;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.port.EventSink;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import io.github.preagile.reputationpool.persistence.PostgresAuditTrail;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Docker-free unit test for the per-tenant fan-out wiring (#29): the registry must join each tenant's
 * pool to <em>that tenant's</em> {@code forPool(tenantId)} views of the shared broadcaster and audit
 * trail, so a pool's events reach only its own tenant's live stream and audit history. The broadcaster
 * and audit trail are mocked so each {@code forPool(id)} hands back a capturing sink, letting the test
 * read exactly what a given tenant's pool emitted without a database or a live gRPC subscriber. (That the
 * subscription side then joins the matching pool is the advisor service's {@code subscriptionPoolId()}
 * override, covered by the gRPC in-process test.)
 */
@DisplayName("PerTenantPoolRegistry: 각 테넌트 풀을 자기 테넌트의 이벤트 스트림·감사 뷰(forPool)에만 합류시켜 격리하는 레지스트리")
class PerTenantPoolRegistryTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-07-16T00:00:00Z"), ZoneOffset.UTC);

    private static ReputationPoolProperties props() {
        return new ReputationPoolProperties(
                Duration.ofSeconds(30),
                Duration.ofSeconds(30),
                new ReputationPoolProperties.Engine(10, 2, 2),
                new ReputationPoolProperties.Audit(Duration.ofHours(1), Duration.ZERO),
                new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
                new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)),
                new ReputationPoolProperties.Limits(100_000, 500_000));
    }

    /** An in-memory store the build() path can wire without a database; restore is the lifecycle's job. */
    private final Function<String, ResourceStore> storeFactory = tenantId -> new ResourceStore() {
        @Override
        public void save(PoolSnapshot snapshot) {}

        @Override
        public Optional<PoolSnapshot> load() {
            return Optional.empty();
        }
    };

    private static ResourceId proxy(String value) {
        return new ResourceId(ResourceKind.PROXY, value);
    }

    /** Only the null-check in the constructor needs it here; build()/poolFor never touch the repository. */
    private static final TenantRepository NO_TENANTS = new TenantRepository() {
        @Override
        public void create(Tenant tenant) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<Tenant> findAll() {
            return List.of();
        }

        @Override
        public Optional<Tenant> findById(String id) {
            return Optional.empty();
        }
    };

    @Test
    @DisplayName("한 테넌트의 풀이 이벤트를 내면 → 그 테넌트의 broadcaster/audit forPool 뷰에만 실리고 다른 테넌트 뷰에는 실리지 않는다")
    void poolEmitsOnlyToItsOwnTenantForPoolViews() {
        EventBroadcaster broadcaster = mock(EventBroadcaster.class);
        PostgresAuditTrail auditTrail = mock(PostgresAuditTrail.class);

        List<PoolEvent> aBroadcast = new ArrayList<>();
        List<PoolEvent> aAudit = new ArrayList<>();
        List<PoolEvent> bBroadcast = new ArrayList<>();
        List<PoolEvent> bAudit = new ArrayList<>();
        when(broadcaster.forPool("tenant-a")).thenReturn((EventSink) aBroadcast::add);
        when(auditTrail.forPool("tenant-a")).thenReturn((EventSink) aAudit::add);
        when(broadcaster.forPool("tenant-b")).thenReturn((EventSink) bBroadcast::add);
        when(auditTrail.forPool("tenant-b")).thenReturn((EventSink) bAudit::add);

        PerTenantPoolRegistry registry = new PerTenantPoolRegistry(
                clock, broadcaster, auditTrail, event -> {}, props(), NO_TENANTS, storeFactory, new MeterRecorder());

        // Building tenant-a's pool must bind it to tenant-a's forPool views (never a bare/default one).
        registry.poolFor("tenant-a").blockPermanently(proxy("x"));
        verify(broadcaster).forPool("tenant-a");
        verify(auditTrail).forPool("tenant-a");

        // The blocklist event reached exactly tenant-a's two per-tenant sinks.
        assertThat(aBroadcast).hasSize(1);
        assertThat(aAudit).hasSize(1);
        assertThat(aBroadcast.get(0)).isInstanceOf(PoolEvent.ResourceBlocklisted.class);

        // Tenant-b's pool is a separate join: its sinks stay empty until it emits, and tenant-a's event
        // never crosses into them.
        registry.poolFor("tenant-b").blockPermanently(proxy("y"));
        assertThat(bBroadcast).hasSize(1);
        assertThat(bAudit).hasSize(1);
        assertThat(aBroadcast).hasSize(1); // unchanged — no cross-tenant leak
    }
}
