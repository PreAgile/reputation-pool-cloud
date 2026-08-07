package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.metering.MeterRecorder;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicy;
import io.github.preagile.reputationpool.cloud.policy.EnginePolicySource;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.Outcome;
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
import org.junit.jupiter.api.Nested;
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
                new ReputationPoolProperties.Engine(10, 2, 2, 6, 1.0),
                new ReputationPoolProperties.Audit(Duration.ofHours(1), Duration.ZERO),
                new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
                new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)),
                new ReputationPoolProperties.Limits(100_000, 500_000),
                new ReputationPoolProperties.SurgeThresholds(10, 1),
                new ReputationPoolProperties.PolicyCeiling(10));
    }

    /** The instance-wide defaults — what a tenant with no stored policy runs (and what all tenants ran before #179). */
    private static final EnginePolicySource INSTANCE_DEFAULTS = tenantId -> EnginePolicy.defaultsFrom(props());

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

        @Override
        public boolean compareAndSetStatus(
                String id,
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus expected,
                io.github.preagile.reputationpool.cloud.tenant.TenantStatus next) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean deleteTenantData(
                String id, io.github.preagile.reputationpool.cloud.tenant.TenantStatus expectedCurrentStatus) {
            throw new UnsupportedOperationException();
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
                clock,
                broadcaster,
                auditTrail,
                event -> {},
                INSTANCE_DEFAULTS,
                NO_TENANTS,
                storeFactory,
                new MeterRecorder());

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

    /**
     * Per-tenant engine policy (#179). Asserted through what each pool <em>does</em>, not through what it
     * was handed: {@code ResourcePool} exposes neither its engine nor its lease TTL, and reading back a
     * value the test itself just passed in would pass even if {@code build} wired it to the wrong pool.
     * Cooling is the cheapest observable difference — a pool cools a resource on its
     * {@code coolAfter}-th consecutive failure and emits {@code ResourceCooled} — so two tenants
     * configured with different thresholds must disagree at exactly the failure count between them.
     */
    @Nested
    @DisplayName("테넌트별 엔진 정책 주입 (#179)")
    class PerTenantPolicy {

        private final List<PoolEvent> aEvents = new ArrayList<>();
        private final List<PoolEvent> bEvents = new ArrayList<>();

        /** Wires each tenant's forPool views to a capturing list, reusing the isolation test's mock pattern. */
        private PerTenantPoolRegistry registryWith(EnginePolicySource policies) {
            EventBroadcaster broadcaster = mock(EventBroadcaster.class);
            PostgresAuditTrail auditTrail = mock(PostgresAuditTrail.class);
            when(broadcaster.forPool("tenant-a")).thenReturn((EventSink) aEvents::add);
            when(broadcaster.forPool("tenant-b")).thenReturn((EventSink) bEvents::add);
            when(auditTrail.forPool("tenant-a")).thenReturn((EventSink) event -> {});
            when(auditTrail.forPool("tenant-b")).thenReturn((EventSink) event -> {});
            return new PerTenantPoolRegistry(
                    clock,
                    broadcaster,
                    auditTrail,
                    event -> {},
                    policies,
                    NO_TENANTS,
                    storeFactory,
                    new MeterRecorder());
        }

        private void reportFailures(PerTenantPoolRegistry registry, String tenantId, int times) {
            for (int i = 0; i < times; i++) {
                registry.poolFor(tenantId)
                        .report(proxy("p"), Context.GLOBAL, new Outcome.Failure(FailureType.TIMEOUT, Duration.ZERO));
            }
        }

        private static List<PoolEvent.ResourceCooled> cooled(List<PoolEvent> events) {
            return events.stream()
                    .filter(PoolEvent.ResourceCooled.class::isInstance)
                    .map(PoolEvent.ResourceCooled.class::cast)
                    .toList();
        }

        @Test
        @DisplayName("A 는 cool-after=2, B 는 3 으로 정책을 주면 → 실패 2회에서 A 만 ResourceCooled 를 내고 B 는 내지 않는다")
        void differentCoolAfter_coolsAtDifferentFailureCounts() {
            EnginePolicy shared = EnginePolicy.defaultsFrom(props());
            EnginePolicySource policies = tenantId -> switch (tenantId) {
                case "tenant-a" -> new EnginePolicy(10, 2, 2, Duration.ofSeconds(30), 6, 1.0);
                case "tenant-b" -> new EnginePolicy(10, 3, 2, Duration.ofSeconds(30), 6, 1.0);
                default -> shared;
            };
            PerTenantPoolRegistry registry = registryWith(policies);

            reportFailures(registry, "tenant-a", 2);
            reportFailures(registry, "tenant-b", 2);

            // The threshold is the only difference between the two pools, so it is the only thing that can
            // explain one cooling and the other not.
            assertThat(cooled(aEvents)).hasSize(1);
            assertThat(cooled(bEvents)).isEmpty();

            // And B is not simply broken: it cools on its own third failure.
            reportFailures(registry, "tenant-b", 1);
            assertThat(cooled(bEvents)).hasSize(1);
        }

        @Test
        @DisplayName("정책이 저장되지 않은 테넌트는 → 전역 기본값(cool-after=2)으로 지어져 #179 이전과 똑같이 동작한다")
        void tenantWithoutAStoredPolicy_behavesExactlyAsBefore() {
            PerTenantPoolRegistry registry = registryWith(INSTANCE_DEFAULTS);

            // One failure short of the configured threshold: silent, exactly as before this change.
            reportFailures(registry, "tenant-a", 1);
            assertThat(cooled(aEvents)).isEmpty();

            reportFailures(registry, "tenant-a", 1);
            assertThat(cooled(aEvents)).hasSize(1);
        }

        @Test
        @DisplayName("정책 조회는 풀을 지을 때 테넌트마다 한 번만 일어난다 → 이후 호출은 캐시된 풀을 그대로 쓴다")
        void policyIsResolvedOncePerTenant() {
            List<String> lookups = new ArrayList<>();
            EnginePolicy defaults = EnginePolicy.defaultsFrom(props());
            PerTenantPoolRegistry registry = registryWith(tenantId -> {
                lookups.add(tenantId);
                return defaults;
            });

            registry.poolFor("tenant-a");
            registry.poolFor("tenant-a");
            registry.poolFor("tenant-b");

            // Two builds, two lookups — a lookup on every call would put a database round trip on the
            // data plane's hot path.
            assertThat(lookups).containsExactly("tenant-a", "tenant-b");
        }
    }
}
