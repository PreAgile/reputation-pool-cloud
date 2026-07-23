package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
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
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Docker-free unit tests for the multi-tenant durable lifecycle. A real {@link PerTenantPoolRegistry}
 * is wired with a fake tenant repository and an in-memory store factory (one {@link RecordingStore} per
 * tenant), so the fan-out — restore and checkpoint across tenants, with per-tenant exception isolation —
 * is exercised without a database. The opt-in retention purge (shared audit, unchanged from the
 * reference) is covered too.
 */
@DisplayName("PoolLifecycle: 멀티 테넌트 풀을 테넌트별 예외 격리 아래 복원·체크포인트하고 감사 로그를 정리하는 생명주기 관리자")
class PoolLifecycleTest {

    private static final Instant NOW = Instant.parse("2026-07-16T00:00:00Z");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

    private final ConcurrentHashMap<String, RecordingStore> stores = new ConcurrentHashMap<>();
    private final Function<String, ResourceStore> storeFactory =
            tenantId -> stores.computeIfAbsent(tenantId, id -> new RecordingStore());

    // The per-tenant event stream + audit trail the registry joins via forPool(tenantId). Both are real
    // upstream types but harmless here: the broadcaster has no subscribers, and the trail is backed by a
    // mock DataSource so its background writer just drops what it drains — no database, still Docker-free.
    // Only pool state (restore/checkpoint) is under test, so audit persistence is deliberately inert.
    private final EventBroadcaster broadcaster = new EventBroadcaster();
    private final PostgresAuditTrail auditTrail = new PostgresAuditTrail(mock(DataSource.class));

    @AfterEach
    void closeAuditTrail() {
        auditTrail.close();
    }

    private ReputationPoolProperties propsWithRetention(Duration retention) {
        return new ReputationPoolProperties(
                Duration.ofSeconds(30),
                Duration.ofSeconds(30),
                new ReputationPoolProperties.Engine(10, 2, 2),
                new ReputationPoolProperties.Audit(Duration.ofHours(1), retention),
                new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
                new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)));
    }

    private PerTenantPoolRegistry registry(TenantRepository repository) {
        return new PerTenantPoolRegistry(
                clock,
                broadcaster,
                auditTrail,
                event -> {},
                propsWithRetention(Duration.ZERO),
                repository,
                storeFactory,
                new io.github.preagile.reputationpool.cloud.metering.MeterRecorder());
    }

    private PoolLifecycle lifecycle(PerTenantPoolRegistry registry, Duration retention, AuditPurger purger) {
        return new PoolLifecycle(registry, purger, clock, propsWithRetention(retention));
    }

    private static TenantRepository tenants(String... ids) {
        List<Tenant> list = new ArrayList<>();
        for (String id : ids) {
            list.add(new Tenant(id, id, io.github.preagile.reputationpool.cloud.tenant.TenantStatus.ACTIVE, NOW));
        }
        return new FakeTenantRepository(list);
    }

    private static ResourceId proxy(String value) {
        return new ResourceId(ResourceKind.PROXY, value);
    }

    @Nested
    @DisplayName("start: 각 테넌트의 저장된 스냅샷을 자기 풀로 복원하며 실패를 격리한다")
    class WhenStarting {

        @Test
        @DisplayName("각 테넌트 스토어에 서로 다른 스냅샷이 저장돼 있으면 → 시작 시 각 풀은 남의 것이 아닌 자기 스냅샷만 복원한다")
        void start_restoresEachTenantsSnapshotIntoItsOwnPool() {
            // Each tenant's store carries a distinct saved snapshot; after restore, each pool must hold its
            // own — never the other tenant's.
            PerTenantPoolRegistry registry = registry(tenants("tenant-a", "tenant-b"));
            stores.put("tenant-a", RecordingStore.loadedWith(snapshotWith(proxy("a1"))));
            stores.put("tenant-b", RecordingStore.loadedWith(snapshotWith(proxy("b1"))));

            lifecycle(registry, Duration.ZERO, cutoff -> 0).start();

            assertThat(registry.poolFor("tenant-a").snapshot().registered()).containsExactly(proxy("a1"));
            assertThat(registry.poolFor("tenant-b").snapshot().registered()).containsExactly(proxy("b1"));
        }

        @Test
        @DisplayName("스토어가 비어 있으면(최초 기동) → 아무것도 복원하지 않고 빈 풀로 시작한다")
        void start_onEmptyStores_isFirstRunWithNothingRestored() {
            PerTenantPoolRegistry registry = registry(tenants("tenant-a"));

            lifecycle(registry, Duration.ZERO, cutoff -> 0).start();

            assertThat(registry.poolFor("tenant-a").snapshot().registered()).isEmpty();
        }

        @Test
        @DisplayName("한 테넌트의 복원이 실패해도 → 예외 없이 나머지 테넌트는 정상 복원되고 running 상태가 된다")
        void start_isolatesAFailingTenantSoTheOthersStillRestore() {
            PerTenantPoolRegistry registry = registry(tenants("bad", "good"));
            stores.put("bad", RecordingStore.failingLoad());
            stores.put("good", RecordingStore.loadedWith(snapshotWith(proxy("g1"))));

            PoolLifecycle lifecycle = lifecycle(registry, Duration.ZERO, cutoff -> 0);
            assertThatCode(lifecycle::start).doesNotThrowAnyException();

            assertThat(lifecycle.isRunning()).isTrue();
            assertThat(registry.poolFor("good").snapshot().registered()).containsExactly(proxy("g1"));
        }
    }

    @Nested
    @DisplayName("checkpoint: 각 테넌트 풀의 스냅샷을 자기 스토어로 저장하며 실패를 격리한다")
    class WhenCheckpointing {

        @Test
        @DisplayName("각 테넌트 풀에 리소스가 등록돼 있으면 → 체크포인트 시 각 스토어에 자기 스냅샷을 저장한다")
        void checkpoint_savesEachTenantsSnapshotToItsOwnStore() {
            PerTenantPoolRegistry registry = registry(tenants("tenant-a", "tenant-b"));
            registry.poolFor("tenant-a").register(proxy("a1"));
            registry.poolFor("tenant-b").register(proxy("b1"));

            lifecycle(registry, Duration.ZERO, cutoff -> 0).checkpoint();

            assertThat(stores.get("tenant-a").lastSaved().registered()).containsExactly(proxy("a1"));
            assertThat(stores.get("tenant-b").lastSaved().registered()).containsExactly(proxy("b1"));
        }

        @Test
        @DisplayName("한 테넌트의 저장이 실패해도 → 예외 없이 나머지 테넌트는 정상 저장된다")
        void checkpoint_isolatesAFailingTenantSoTheOthersStillSave() {
            PerTenantPoolRegistry registry = registry(tenants("bad", "good"));
            stores.put("bad", RecordingStore.failingSave());
            registry.poolFor("bad").register(proxy("x"));
            registry.poolFor("good").register(proxy("g1"));

            PoolLifecycle lifecycle = lifecycle(registry, Duration.ZERO, cutoff -> 0);
            assertThatCode(lifecycle::checkpoint).doesNotThrowAnyException();

            assertThat(stores.get("good").lastSaved().registered()).containsExactly(proxy("g1"));
        }
    }

    @Nested
    @DisplayName("purgeExpiredAuditEvents: 보존 기간에 따라 만료된 감사 로그를 정리한다")
    class WhenPurging {

        @Test
        @DisplayName("보존 기간이 비활성(0)이면 → 퍼저를 아예 호출하지 않는다(no-op)")
        void purge_isNoOp_whenRetentionDisabled() {
            AtomicReference<Instant> calledWith = new AtomicReference<>();
            PoolLifecycle lifecycle = lifecycle(registry(tenants()), Duration.ZERO, cutoff -> {
                calledWith.set(cutoff);
                return 0;
            });

            lifecycle.purgeExpiredAuditEvents();

            assertThat(calledWith.get()).isNull();
        }

        @Test
        @DisplayName("보존 기간이 설정돼 있으면 → now - 보존기간 을 컷오프로 퍼저를 호출한다")
        void purge_trimsOlderThanNowMinusRetention_whenEnabled() {
            AtomicReference<Instant> calledWith = new AtomicReference<>();
            Duration retention = Duration.ofDays(30);
            PoolLifecycle lifecycle = lifecycle(registry(tenants()), retention, cutoff -> {
                calledWith.set(cutoff);
                return 3;
            });

            lifecycle.purgeExpiredAuditEvents();

            assertThat(calledWith.get()).isEqualTo(NOW.minus(retention));
        }

        @Test
        @DisplayName("퍼저가 예외를 던져도 → 삼켜서 호출자에게 전파하지 않는다")
        void purge_swallowsPurgerFailure() {
            AuditPurger failing = cutoff -> {
                throw new IllegalStateException("transient DB error");
            };
            PoolLifecycle lifecycle = lifecycle(registry(tenants()), Duration.ofDays(30), failing);

            assertThatCode(lifecycle::purgeExpiredAuditEvents).doesNotThrowAnyException();
        }
    }

    private PoolSnapshot snapshotWith(ResourceId resource) {
        ResourcePool pool = new ResourcePool(
                new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                new WeightedRandomSelectionStrategy(),
                event -> {},
                clock,
                new Random(42),
                Duration.ofSeconds(30));
        pool.register(resource);
        return pool.snapshot();
    }

    /** A fake {@link ResourceStore} that records the last saved snapshot and returns a preset load. */
    private static final class RecordingStore implements ResourceStore {
        private final Optional<PoolSnapshot> toLoad;
        private final boolean failLoad;
        private final boolean failSave;
        private PoolSnapshot lastSaved;

        RecordingStore() {
            this(Optional.empty(), false, false);
        }

        private RecordingStore(Optional<PoolSnapshot> toLoad, boolean failLoad, boolean failSave) {
            this.toLoad = toLoad;
            this.failLoad = failLoad;
            this.failSave = failSave;
        }

        static RecordingStore loadedWith(PoolSnapshot snapshot) {
            return new RecordingStore(Optional.of(snapshot), false, false);
        }

        static RecordingStore failingLoad() {
            return new RecordingStore(Optional.empty(), true, false);
        }

        static RecordingStore failingSave() {
            return new RecordingStore(Optional.empty(), false, true);
        }

        @Override
        public void save(PoolSnapshot snapshot) {
            if (failSave) {
                throw new IllegalStateException("transient DB error on save");
            }
            this.lastSaved = snapshot;
        }

        @Override
        public Optional<PoolSnapshot> load() {
            if (failLoad) {
                throw new IllegalStateException("transient DB error on load");
            }
            return toLoad;
        }

        PoolSnapshot lastSaved() {
            return lastSaved;
        }
    }

    /** A fake {@link TenantRepository} over an in-memory list — only {@link #findAll()} is exercised here. */
    private record FakeTenantRepository(List<Tenant> all) implements TenantRepository {
        @Override
        public void create(Tenant tenant) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<Tenant> findAll() {
            return all;
        }

        @Override
        public Optional<Tenant> findById(String id) {
            return all.stream().filter(t -> t.id().equals(id)).findFirst();
        }

        @Override
        public void updateStatus(String id, io.github.preagile.reputationpool.cloud.tenant.TenantStatus status) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void deleteTenantData(String id) {
            throw new UnsupportedOperationException();
        }
    }
}
