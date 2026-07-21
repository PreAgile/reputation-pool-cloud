package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.PoolOverview;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.ResourceDetail;
import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.ResourceOverview;
import io.github.preagile.reputationpool.core.domain.Blocklist;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.Outcome;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.domain.ResourceState;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Unit test for the read-model assembly (issue #11): pure functions of a {@link PoolSnapshot}, so no
 * database or engine. Proves the KPI aggregation, the per-resource rollup, and the sentinel
 * normalization (EPOCH cooldown → null, {@link Instant#MAX} block → permanent).
 */
@DisplayName("PoolViewAssembler: 풀 스냅샷을 대시보드용 읽기 모델(요약 KPI·리소스별 뷰)로 조립하는 순수 어셈블러")
class PoolViewAssemblerTest {

    private static final Instant NOW = Instant.parse("2026-07-16T00:00:00Z");

    private final ResourceId p1 = new ResourceId(ResourceKind.PROXY, "p1");
    private final ResourceId p2 = new ResourceId(ResourceKind.PROXY, "p2");

    @Nested
    @DisplayName("overview(): 풀 전체를 요약 KPI + 리소스별 행 목록으로 집계할 때")
    class Overview {

        @Test
        @DisplayName("스냅샷을 넘기면 → 요약 KPI(등록 수·차단 수·상태별 셀 수)와 리소스별 행을 함께 집계한다")
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
        @DisplayName("한 리소스에 여러 셀이 있으면 → 가장 나쁜 상태·가장 낮은 점수와 바로 그 셀의 최근 윈도우로 대표한다")
        void overview_representsResourceByWorstStateWorstScoreAndThatCellsWindow() {
            // p1 has two cells: a healthy one with the higher score, and a cooling one with the lower score
            // whose window is fail, success, fail. The row must read COOLING (worst severity), score -5.0
            // (worst), and the cooling cell's window as [false, true, false].
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(
                    new CellKey(p1, new Context("healthy")),
                    ReputationCell.fresh(p1, new Context("healthy"), NOW).toBuilder()
                            .score(3.0)
                            .state(ResourceState.HEALTHY)
                            .window(List.of(new Outcome.Success(Duration.ofMillis(10))))
                            .build());
            cells.put(
                    new CellKey(p1, new Context("cooling")),
                    ReputationCell.fresh(p1, new Context("cooling"), NOW).toBuilder()
                            .score(-5.0)
                            .state(ResourceState.COOLING)
                            .window(List.of(
                                    new Outcome.Failure(FailureType.TIMEOUT, Duration.ofMillis(20)),
                                    new Outcome.Success(Duration.ofMillis(10)),
                                    new Outcome.Failure(FailureType.BLOCKED, Duration.ofMillis(30))))
                            .build());
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), java.util.Set.of(p1));

            ResourceOverview row = only(PoolViewAssembler.overview(snapshot, NOW));

            assertThat(row.state()).isEqualTo("COOLING");
            assertThat(row.score()).isEqualTo(-5.0);
            assertThat(row.recentWindow()).containsExactly(false, true, false);
        }

        @Test
        @DisplayName("리소스가 차단돼 있으면 → 셀 상태와 무관하게 BLOCKLISTED 로 표시하되 점수·윈도우는 셀에서 그대로 가져온다")
        void overview_blockedResourceReadsBlocklistedRegardlessOfCellStates() {
            // p2 is permanently blocked but its only cell is HEALTHY: block wins the state, yet score/window
            // still come from the cell.
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(
                    new CellKey(p2, new Context("a")),
                    ReputationCell.fresh(p2, new Context("a"), NOW).toBuilder()
                            .score(1.5)
                            .state(ResourceState.HEALTHY)
                            .window(List.of(new Outcome.Success(Duration.ofMillis(10))))
                            .build());
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty().blockPermanently(p2), java.util.Set.of());

            ResourceOverview row = only(PoolViewAssembler.overview(snapshot, NOW));

            assertThat(row.state()).isEqualTo("BLOCKLISTED");
            assertThat(row.score()).isEqualTo(1.5);
            assertThat(row.recentWindow()).containsExactly(true);
        }

        @Test
        @DisplayName("셀이 하나도 없는 등록 리소스면 → 상태 HEALTHY·점수 null·빈 윈도우로 나타낸다")
        void overview_resourceWithoutCellsHasNullScoreEmptyWindowAndHealthyState() {
            // A registered resource never yet used: no cells → HEALTHY, null score, empty window.
            PoolSnapshot snapshot = new PoolSnapshot(new HashMap<>(), Blocklist.empty(), java.util.Set.of(p1));

            ResourceOverview row = only(PoolViewAssembler.overview(snapshot, NOW));

            assertThat(row.state()).isEqualTo("HEALTHY");
            assertThat(row.score()).isNull();
            assertThat(row.recentWindow()).isEmpty();
        }
    }

    @Nested
    @DisplayName("detail(): 리소스 하나의 컨텍스트별 상세를 조회할 때")
    class Detail {

        @Test
        @DisplayName("리소스 상세를 요청하면 → 컨텍스트 순으로 정렬해 펼치고 EPOCH 쿨다운 센티넬은 null 로 정규화한다")
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
        @DisplayName("존재하지 않는 리소스를 요청하면 → 빈 결과(Optional.empty)를 돌려준다")
        void detail_ofUnknownResource_isEmpty() {
            assertThat(PoolViewAssembler.detail(snapshot(), new ResourceId(ResourceKind.PROXY, "nope"), NOW))
                    .isEmpty();
        }
    }

    private static ResourceOverview only(PoolOverview overview) {
        assertThat(overview.resources()).hasSize(1);
        return overview.resources().get(0);
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
