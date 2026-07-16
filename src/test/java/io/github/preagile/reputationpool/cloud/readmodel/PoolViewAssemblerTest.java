package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.PoolOverview;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.ResourceDetail;
import io.github.preagile.reputationpool.core.domain.Blocklist;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.domain.ResourceState;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Unit test for the read-model assembly (issue #11): pure functions of a {@link PoolSnapshot}, so no
 * database or engine. Proves the KPI aggregation, the per-resource rollup, and the sentinel
 * normalization (EPOCH cooldown → null, {@link Instant#MAX} block → permanent).
 */
class PoolViewAssemblerTest {

    private static final Instant NOW = Instant.parse("2026-07-16T00:00:00Z");

    private final ResourceId p1 = new ResourceId(ResourceKind.PROXY, "p1");
    private final ResourceId p2 = new ResourceId(ResourceKind.PROXY, "p2");

    @Test
    void overview_aggregatesKpisAndResources() {
        PoolSnapshot snapshot = snapshot();

        PoolOverview overview = PoolViewAssembler.overview(snapshot, NOW);

        assertThat(overview.summary().registered()).isEqualTo(1);
        assertThat(overview.summary().blocklisted()).isEqualTo(1);
        assertThat(overview.summary().totalCells()).isEqualTo(2);
        assertThat(overview.summary().cellsByState())
                .containsEntry("HEALTHY", 1)
                .containsEntry("COOLING", 1)
                .containsEntry("BLOCKLISTED", 0);
        // p1 (registered, two contexts) and p2 (blocked) both appear.
        assertThat(overview.resources()).hasSize(2);
        assertThat(overview.resources())
                .anySatisfy(r -> {
                    assertThat(r.value()).isEqualTo("p1");
                    assertThat(r.registered()).isTrue();
                    assertThat(r.contexts()).isEqualTo(2);
                    assertThat(r.blocked()).isFalse();
                })
                .anySatisfy(r -> {
                    assertThat(r.value()).isEqualTo("p2");
                    assertThat(r.blocked()).isTrue();
                    assertThat(r.blockPermanent()).isTrue();
                    assertThat(r.blockedUntil()).isNull(); // permanent → null + flag
                });
    }

    @Test
    void detail_expandsContextsAndNormalizesCooldownSentinel() {
        Optional<ResourceDetail> detail = PoolViewAssembler.detail(snapshot(), p1, NOW);

        assertThat(detail).isPresent();
        assertThat(detail.get().cells()).hasSize(2);
        // Sorted by context: "a" (HEALTHY, not cooling) then "b" (COOLING, cooldown in the future).
        assertThat(detail.get().cells().get(0).context()).isEqualTo("a");
        assertThat(detail.get().cells().get(0).cooldownUntil()).isNull();
        assertThat(detail.get().cells().get(1).context()).isEqualTo("b");
        assertThat(detail.get().cells().get(1).cooldownUntil()).isEqualTo(NOW.plusSeconds(60));
    }

    @Test
    void detail_ofUnknownResource_isEmpty() {
        assertThat(PoolViewAssembler.detail(snapshot(), new ResourceId(ResourceKind.PROXY, "nope"), NOW))
                .isEmpty();
    }

    private PoolSnapshot snapshot() {
        Map<CellKey, ReputationCell> cells = new HashMap<>();
        cells.put(
                new CellKey(p1, new Context("a")),
                ReputationCell.fresh(p1, new Context("a"), NOW)); // HEALTHY, cooldown EPOCH
        cells.put(
                new CellKey(p1, new Context("b")),
                ReputationCell.fresh(p1, new Context("b"), NOW).toBuilder()
                        .state(ResourceState.COOLING)
                        .cooldownUntil(NOW.plusSeconds(60))
                        .build());
        Blocklist blocklist = Blocklist.empty().blockPermanently(p2);
        return new PoolSnapshot(cells, blocklist, java.util.Set.of(p1));
    }
}
