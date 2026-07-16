package io.github.preagile.reputationpool.cloud.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/**
 * Docker-free unit tests for the durable lifecycle, using fakes for the store and the audit purger and
 * a real in-memory pool — the same testing shape the reference {@code AdvisorServer} lifecycle tests
 * use. Verifies restore-on-start, checkpoint save + exception isolation, and opt-in retention purge.
 */
class PoolLifecycleTest {

    private static final Instant NOW = Instant.parse("2026-07-16T00:00:00Z");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

    private ResourcePool newPool() {
        return new ResourcePool(
                new ReputationEngine(new AdaptiveCooldownPolicy(), 10, 2, 2),
                new WeightedRandomSelectionStrategy(),
                event -> {}, // no-op sink for the unit under test
                clock,
                new Random(42),
                Duration.ofSeconds(30));
    }

    private ReputationPoolProperties propsWithRetention(Duration retention) {
        return new ReputationPoolProperties(
                Duration.ofSeconds(30),
                Duration.ofSeconds(30),
                new ReputationPoolProperties.Engine(10, 2, 2),
                new ReputationPoolProperties.Audit(Duration.ofHours(1), retention));
    }

    @Test
    void start_restoresTheSavedSnapshotIntoThePool() {
        ResourcePool source = newPool();
        source.register(new ResourceId(ResourceKind.PROXY, "p1"));
        PoolSnapshot saved = source.snapshot();

        ResourcePool pool = newPool();
        RecordingStore store = new RecordingStore(Optional.of(saved));
        PoolLifecycle lifecycle = new PoolLifecycle(pool, store, cutoff -> 0, clock, propsWithRetention(Duration.ZERO));

        lifecycle.start();

        assertThat(lifecycle.isRunning()).isTrue();
        assertThat(pool.snapshot()).isEqualTo(saved);
        assertThat(pool.snapshot().registered()).containsExactly(new ResourceId(ResourceKind.PROXY, "p1"));
    }

    @Test
    void start_onEmptyStore_isFirstRunWithNothingRestored() {
        ResourcePool pool = newPool();
        RecordingStore store = new RecordingStore(Optional.empty());
        PoolLifecycle lifecycle = new PoolLifecycle(pool, store, cutoff -> 0, clock, propsWithRetention(Duration.ZERO));

        lifecycle.start();

        assertThat(pool.snapshot().registered()).isEmpty();
    }

    @Test
    void checkpoint_savesTheCurrentSnapshot() {
        ResourcePool pool = newPool();
        pool.register(new ResourceId(ResourceKind.ACCOUNT, "a1"));
        RecordingStore store = new RecordingStore(Optional.empty());
        PoolLifecycle lifecycle = new PoolLifecycle(pool, store, cutoff -> 0, clock, propsWithRetention(Duration.ZERO));

        lifecycle.checkpoint();

        assertThat(store.lastSaved()).isEqualTo(pool.snapshot());
    }

    @Test
    void checkpoint_swallowsStoreFailure_soTheScheduleSurvives() {
        ResourcePool pool = newPool();
        ResourceStore failing = new ResourceStore() {
            @Override
            public void save(PoolSnapshot snapshot) {
                throw new IllegalStateException("transient DB error");
            }

            @Override
            public Optional<PoolSnapshot> load() {
                return Optional.empty();
            }
        };
        PoolLifecycle lifecycle =
                new PoolLifecycle(pool, failing, cutoff -> 0, clock, propsWithRetention(Duration.ZERO));

        assertThatCode(lifecycle::checkpoint).doesNotThrowAnyException();
    }

    @Test
    void purge_isNoOp_whenRetentionDisabled() {
        AtomicReference<Instant> calledWith = new AtomicReference<>();
        PoolLifecycle lifecycle = new PoolLifecycle(
                newPool(),
                new RecordingStore(Optional.empty()),
                cutoff -> {
                    calledWith.set(cutoff);
                    return 0;
                },
                clock,
                propsWithRetention(Duration.ZERO));

        lifecycle.purgeExpiredAuditEvents();

        assertThat(calledWith.get()).isNull();
    }

    @Test
    void purge_trimsOlderThanNowMinusRetention_whenEnabled() {
        AtomicReference<Instant> calledWith = new AtomicReference<>();
        Duration retention = Duration.ofDays(30);
        PoolLifecycle lifecycle = new PoolLifecycle(
                newPool(),
                new RecordingStore(Optional.empty()),
                cutoff -> {
                    calledWith.set(cutoff);
                    return 3;
                },
                clock,
                propsWithRetention(retention));

        lifecycle.purgeExpiredAuditEvents();

        assertThat(calledWith.get()).isEqualTo(NOW.minus(retention));
    }

    @Test
    void purge_swallowsPurgerFailure() {
        AuditPurger failing = cutoff -> {
            throw new IllegalStateException("transient DB error");
        };
        PoolLifecycle lifecycle = new PoolLifecycle(
                newPool(),
                new RecordingStore(Optional.empty()),
                failing,
                clock,
                propsWithRetention(Duration.ofDays(30)));

        assertThatCode(lifecycle::purgeExpiredAuditEvents).doesNotThrowAnyException();
    }

    /** A fake {@link ResourceStore} that records the last saved snapshot and returns a preset load. */
    private static final class RecordingStore implements ResourceStore {
        private final Optional<PoolSnapshot> toLoad;
        private PoolSnapshot lastSaved;

        RecordingStore(Optional<PoolSnapshot> toLoad) {
            this.toLoad = toLoad;
        }

        @Override
        public void save(PoolSnapshot snapshot) {
            this.lastSaved = snapshot;
        }

        @Override
        public Optional<PoolSnapshot> load() {
            return toLoad;
        }

        PoolSnapshot lastSaved() {
            return lastSaved;
        }
    }
}
