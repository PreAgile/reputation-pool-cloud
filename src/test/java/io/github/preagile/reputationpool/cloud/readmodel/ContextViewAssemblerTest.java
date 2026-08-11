package io.github.preagile.reputationpool.cloud.readmodel;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler.ContextDetail;
import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler.ContextOverview;
import io.github.preagile.reputationpool.cloud.readmodel.ContextViewAssembler.ContextSummary;
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
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Unit test for the context-axis read model: pure functions of a {@link PoolSnapshot}, so no database or
 * engine. Proves the per-context aggregation, the staleness signal ({@code lastUpdatedAt}) that motivates
 * the view, and the worst-first ordering of a context's resources.
 */
@DisplayName("ContextViewAssembler: 풀 스냅샷을 컨텍스트 축(컨텍스트별 요약·컨텍스트 안 리소스 목록)으로 조립하는 순수 어셈블러")
class ContextViewAssemblerTest {

    private static final Instant NOW = Instant.parse("2026-08-11T00:00:00Z");

    private final ResourceId p1 = new ResourceId(ResourceKind.PROXY, "p1");
    private final ResourceId p2 = new ResourceId(ResourceKind.PROXY, "p2");

    @Nested
    @DisplayName("overview(): 스냅샷의 모든 셀을 컨텍스트별로 집계할 때")
    class Overview {

        @Test
        @DisplayName("여러 컨텍스트의 셀이 섞여 있으면 → 컨텍스트마다 셀 수·상태 분포·점수 통계를 따로 집계한다")
        void overview_aggregatesEachContextSeparately() {
            // BAEMIN: p1(HEALTHY, 0.9) + p2(COOLING, 0.1) / MUKKEBI: p1(HEALTHY, 0.5) 하나뿐.
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "BAEMIN"), cell(p1, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            cells.put(key(p2, "BAEMIN"), cell(p2, "BAEMIN", 0.1, ResourceState.COOLING, NOW));
            cells.put(key(p1, "MUKKEBI"), cell(p1, "MUKKEBI", 0.5, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1, p2));

            ContextOverview overview = ContextViewAssembler.overview(snapshot, NOW);

            assertThat(overview.contexts()).hasSize(2);
            ContextSummary baemin = summaryOf(overview, "BAEMIN");
            assertThat(baemin.cells()).isEqualTo(2);
            assertThat(baemin.cellsByState()).containsEntry("HEALTHY", 1).containsEntry("COOLING", 1);
            assertThat(baemin.averageScore()).isEqualTo(0.5);
            assertThat(baemin.worstScore()).isEqualTo(0.1);
            assertThat(baemin.bestScore()).isEqualTo(0.9);
            ContextSummary mukkebi = summaryOf(overview, "MUKKEBI");
            assertThat(mukkebi.cells()).isEqualTo(1);
            assertThat(mukkebi.averageScore()).isEqualTo(0.5);
        }

        @Test
        @DisplayName("컨텍스트마다 마지막 갱신 시각이 다르면 → 그 컨텍스트에서 가장 최근 셀의 시각을 lastUpdatedAt 으로 준다")
        void overview_reportsNewestCellUpdateAsLastActivity() {
            // 이 뷰가 존재하는 이유: 보고가 끊긴 컨텍스트는 리소스 축에서 건강한 것과 구분되지 않는다.
            // 오래된 lastUpdatedAt 이 "이 컨텍스트는 조용하다"는 유일한 신호다.
            Instant stale = NOW.minus(Duration.ofDays(4));
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "LIVE"), cell(p1, "LIVE", 0.8, ResourceState.HEALTHY, NOW.minusSeconds(30)));
            cells.put(key(p2, "LIVE"), cell(p2, "LIVE", 0.8, ResourceState.HEALTHY, NOW.minusSeconds(90)));
            cells.put(key(p1, "SILENT"), cell(p1, "SILENT", 0.8, ResourceState.HEALTHY, stale));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1, p2));

            ContextOverview overview = ContextViewAssembler.overview(snapshot, NOW);

            assertThat(summaryOf(overview, "LIVE").lastUpdatedAt()).isEqualTo(NOW.minusSeconds(30));
            assertThat(summaryOf(overview, "SILENT").lastUpdatedAt()).isEqualTo(stale);
        }

        @Test
        @DisplayName("차단된 리소스의 셀이 섞여 있으면 → 그 컨텍스트의 blocked 수로 센다")
        void overview_countsCellsSittingOnBlockedResources() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "BAEMIN"), cell(p1, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            cells.put(key(p2, "BAEMIN"), cell(p2, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty().blockPermanently(p2), Set.of(p1));

            ContextOverview overview = ContextViewAssembler.overview(snapshot, NOW);

            assertThat(summaryOf(overview, "BAEMIN").blocked()).isEqualTo(1);
        }

        @Test
        @DisplayName("셀은 HEALTHY 인데 리소스가 차단돼 있으면 → 분포는 HEALTHY 로 세면서 대표 상태는 BLOCKLISTED 로 준다")
        void overview_headlineStateFoldsResourceBlockButBreakdownKeepsCellStates() {
            // 두 값이 답하는 질문이 다르다. cellsByState 는 셀 상태의 인구조사(리소스 축 요약과 같은 규칙)이고,
            // state 는 머리기사다. 머리기사를 분포에서 유도하면 차단된 리소스에만 얹힌 컨텍스트가 HEALTHY 로
            // 표시된다 — 화면에서 가장 오해를 부르는 조합이다.
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p2, "BAEMIN"), cell(p2, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty().blockPermanently(p2), Set.of());

            ContextSummary summary = summaryOf(ContextViewAssembler.overview(snapshot, NOW), "BAEMIN");

            assertThat(summary.state()).isEqualTo("BLOCKLISTED");
            assertThat(summary.cellsByState()).containsEntry("HEALTHY", 1).containsEntry("BLOCKLISTED", 0);
            assertThat(summary.blocked()).isEqualTo(1);
        }

        @Test
        @DisplayName("여러 상태가 섞여 있으면 → 대표 상태는 그중 가장 심각한 것이다")
        void overview_headlineStateIsTheWorstSeverityPresent() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "C"), cell(p1, "C", 0.9, ResourceState.HEALTHY, NOW));
            cells.put(key(p2, "C"), cell(p2, "C", 0.4, ResourceState.COOLING, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1, p2));

            assertThat(summaryOf(ContextViewAssembler.overview(snapshot, NOW), "C")
                            .state())
                    .isEqualTo("COOLING");
        }

        @Test
        @DisplayName("컨텍스트 목록을 요청하면 → 폴링마다 흔들리지 않도록 이름 오름차순으로 정렬해 준다")
        void overview_ordersContextsByName() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            for (String context : List.of("YOGIYO", "BAEMIN", "MUKKEBI")) {
                cells.put(key(p1, context), cell(p1, context, 0.5, ResourceState.HEALTHY, NOW));
            }
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1));

            ContextOverview overview = ContextViewAssembler.overview(snapshot, NOW);

            assertThat(overview.contexts())
                    .extracting(ContextSummary::context)
                    .containsExactly("BAEMIN", "MUKKEBI", "YOGIYO");
        }

        @Test
        @DisplayName("셀이 하나도 없는 스냅샷이면 → 빈 컨텍스트 목록을 준다")
        void overview_ofEmptySnapshot_hasNoContexts() {
            PoolSnapshot snapshot = new PoolSnapshot(new HashMap<>(), Blocklist.empty(), Set.of(p1));

            assertThat(ContextViewAssembler.overview(snapshot, NOW).contexts()).isEmpty();
        }
    }

    @Nested
    @DisplayName("detail(): 컨텍스트 하나를 그 안의 리소스 목록으로 펼칠 때")
    class Detail {

        @Test
        @DisplayName("컨텍스트를 요청하면 → 그 컨텍스트의 셀만 골라 리소스 행으로 펼친다")
        void detail_expandsOnlyThatContextsCells() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "BAEMIN"), cell(p1, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            cells.put(key(p1, "MUKKEBI"), cell(p1, "MUKKEBI", 0.2, ResourceState.COOLING, NOW));
            cells.put(key(p2, "MUKKEBI"), cell(p2, "MUKKEBI", 0.7, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1, p2));

            ContextDetail detail =
                    ContextViewAssembler.detail(snapshot, "MUKKEBI", NOW).orElseThrow();

            assertThat(detail.context()).isEqualTo("MUKKEBI");
            assertThat(detail.resources())
                    .extracting(ContextViewAssembler.ContextResourceRow::value)
                    .containsExactlyInAnyOrder("p1", "p2");
        }

        @Test
        @DisplayName("여러 리소스가 있으면 → 심각한 상태 먼저, 같은 상태면 낮은 점수 먼저 정렬한다")
        void detail_ordersWorstFirst() {
            ResourceId p3 = new ResourceId(ResourceKind.PROXY, "p3");
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "C"), cell(p1, "C", 0.9, ResourceState.HEALTHY, NOW));
            cells.put(key(p2, "C"), cell(p2, "C", 0.4, ResourceState.COOLING, NOW));
            cells.put(key(p3, "C"), cell(p3, "C", 0.1, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1, p2, p3));

            ContextDetail detail =
                    ContextViewAssembler.detail(snapshot, "C", NOW).orElseThrow();

            // COOLING(p2) 이 먼저, 그다음 HEALTHY 끼리는 점수 낮은 p3 → p1.
            assertThat(detail.resources())
                    .extracting(ContextViewAssembler.ContextResourceRow::value)
                    .containsExactly("p2", "p3", "p1");
        }

        @Test
        @DisplayName("리소스가 차단돼 있으면 → 셀 상태가 HEALTHY 라도 그 행은 BLOCKLISTED 로 표시한다")
        void detail_blockedResourceReadsBlocklisted() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p2, "C"), cell(p2, "C", 0.9, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty().blockPermanently(p2), Set.of());

            ContextDetail detail =
                    ContextViewAssembler.detail(snapshot, "C", NOW).orElseThrow();

            assertThat(detail.resources()).singleElement().satisfies(row -> {
                assertThat(row.state()).isEqualTo("BLOCKLISTED");
                assertThat(row.blocked()).isTrue();
                assertThat(row.blockPermanent()).isTrue();
                assertThat(row.blockedUntil()).isNull(); // 영구 차단 센티넬 → null + 플래그
                assertThat(row.score()).isEqualTo(0.9); // 점수는 셀 그대로
            });
        }

        @Test
        @DisplayName("셀의 최근 윈도우가 있으면 → 성공 플래그 배열(오래된→최신)로 펼치고 EPOCH 쿨다운은 null 로 정규화한다")
        void detail_exposesWindowFlagsAndNormalizesCooldownSentinel() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(
                    key(p1, "C"),
                    cell(p1, "C", 0.5, ResourceState.HEALTHY, NOW).toBuilder()
                            .window(List.of(
                                    new Outcome.Failure(FailureType.TIMEOUT, Duration.ofMillis(20)),
                                    new Outcome.Success(Duration.ofMillis(10))))
                            .build());
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1));

            ContextDetail detail =
                    ContextViewAssembler.detail(snapshot, "C", NOW).orElseThrow();

            assertThat(detail.resources()).singleElement().satisfies(row -> {
                assertThat(row.recentWindow()).containsExactly(false, true);
                assertThat(row.windowSize()).isEqualTo(2);
                assertThat(row.cooldownUntil()).isNull();
            });
        }

        @Test
        @DisplayName("아무 셀도 갖지 않은 컨텍스트를 요청하면 → 빈 결과(Optional.empty)를 돌려준다")
        void detail_ofUnknownContext_isEmpty() {
            Map<CellKey, ReputationCell> cells = new HashMap<>();
            cells.put(key(p1, "BAEMIN"), cell(p1, "BAEMIN", 0.9, ResourceState.HEALTHY, NOW));
            PoolSnapshot snapshot = new PoolSnapshot(cells, Blocklist.empty(), Set.of(p1));

            assertThat(ContextViewAssembler.detail(snapshot, "NOPE", NOW)).isEmpty();
        }
    }

    private static ContextSummary summaryOf(ContextOverview overview, String context) {
        return overview.contexts().stream()
                .filter(summary -> summary.context().equals(context))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no summary for context " + context));
    }

    private static CellKey key(ResourceId resource, String context) {
        return new CellKey(resource, new Context(context));
    }

    private static ReputationCell cell(
            ResourceId resource, String context, double score, ResourceState state, Instant updatedAt) {
        return ReputationCell.fresh(resource, new Context(context), updatedAt).toBuilder()
                .score(score)
                .state(state)
                .updatedAt(updatedAt)
                .build();
    }
}
