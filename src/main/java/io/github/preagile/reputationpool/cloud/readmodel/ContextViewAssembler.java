package io.github.preagile.reputationpool.cloud.readmodel;

import io.github.preagile.reputationpool.cloud.readmodel.PoolViewAssembler.BlockView;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceState;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * Turns a {@link PoolSnapshot} into the <b>context axis</b> of the dashboard — the counterpart to
 * {@link PoolViewAssembler}, which aggregates the same cells along the resource axis. Pure functions of
 * the snapshot plus the read instant, same as its sibling.
 *
 * <p><b>Why this axis exists.</b> A cell is a {@code (resource × context)} pair, and until now every
 * dashboard view entered through the resource: the overview listed resources with a context <em>count</em>,
 * and the drill-down expanded one resource into its contexts. Nothing answered the question an operator
 * actually asks first — "which contexts is this pool serving, and is any of them degrading or silent?"
 * A context that stops receiving reports looks identical to a healthy one on the resource axis (its cells
 * simply stop moving), which is exactly the failure that goes unnoticed. Hence {@link ContextSummary}
 * carries {@code lastUpdatedAt}: a context whose newest cell is days old is stale, and the view says so
 * without the operator having to open resources one by one.
 *
 * <p><b>Staleness is reported, not judged.</b> This assembler surfaces the timestamp and lets the client
 * decide what counts as stale — a scrape platform that runs weekly is not broken for being quiet, and the
 * read model has no way to know the caller's expected cadence.
 */
public final class ContextViewAssembler {

    private ContextViewAssembler() {}

    /**
     * Every context present in the snapshot, each aggregated over its cells: how many there are, how many
     * sit on a blocked resource, the state breakdown, the score spread, and when the context last moved.
     * Contexts are ordered by name so the list is stable across polls.
     */
    public static ContextOverview overview(PoolSnapshot snapshot, Instant now) {
        Map<String, Accumulator> byContext = new TreeMap<>();
        for (Map.Entry<CellKey, ReputationCell> entry : snapshot.cells().entrySet()) {
            CellKey key = entry.getKey();
            boolean blocked =
                    PoolViewAssembler.blockOf(snapshot, key.resource(), now).blocked();
            byContext
                    .computeIfAbsent(key.context().value(), context -> new Accumulator())
                    .add(entry.getValue(), blocked);
        }
        List<ContextSummary> contexts = new ArrayList<>();
        byContext.forEach((context, accumulator) -> contexts.add(accumulator.toSummary(context)));
        return new ContextOverview(contexts);
    }

    /**
     * One context expanded into the resources that have a cell in it, worst first (most severe state, then
     * lowest score) so the rows needing attention lead. Empty if no cell carries that context — the caller
     * turns that into a 404 rather than an empty page, matching {@link PoolViewAssembler#detail}.
     */
    public static Optional<ContextDetail> detail(PoolSnapshot snapshot, String context, Instant now) {
        List<ContextResourceRow> rows = new ArrayList<>();
        for (Map.Entry<CellKey, ReputationCell> entry : snapshot.cells().entrySet()) {
            CellKey key = entry.getKey();
            if (!key.context().value().equals(context)) {
                continue;
            }
            ResourceId resource = key.resource();
            ReputationCell cell = entry.getValue();
            BlockView block = PoolViewAssembler.blockOf(snapshot, resource, now);
            // A blocked resource reads BLOCKLISTED in this context too: the block is resource-wide, so the
            // cell's own state understates it (the same rule PoolViewAssembler's representative applies).
            String state = block.blocked()
                    ? ResourceState.BLOCKLISTED.name()
                    : cell.state().name();
            rows.add(new ContextResourceRow(
                    resource.kind().name(),
                    resource.value(),
                    snapshot.registered().contains(resource),
                    block.blocked(),
                    block.until(),
                    block.permanent(),
                    state,
                    cell.score(),
                    cell.consecutiveFailures(),
                    cell.consecutiveSuccesses(),
                    cell.window().size(),
                    PoolViewAssembler.successFlags(cell.window()),
                    cell.cooldownUntil().equals(Instant.EPOCH) ? null : cell.cooldownUntil(),
                    cell.updatedAt()));
        }
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        rows.sort(Comparator.comparingInt((ContextResourceRow row) -> severityOf(row.state()))
                .reversed()
                .thenComparingDouble(ContextResourceRow::score)
                .thenComparing(ContextResourceRow::kind)
                .thenComparing(ContextResourceRow::value));
        return Optional.of(new ContextDetail(context, rows));
    }

    private static int severityOf(String state) {
        return PoolViewAssembler.severity(ResourceState.valueOf(state));
    }

    /** Mutable fold of one context's cells; converted to an immutable {@link ContextSummary} at the end. */
    private static final class Accumulator {

        private final Map<ResourceState, Integer> byState = new EnumMap<>(ResourceState.class);
        private int cells;
        private int blocked;
        private double scoreSum;
        private double worstScore = Double.POSITIVE_INFINITY;
        private double bestScore = Double.NEGATIVE_INFINITY;
        private Instant lastUpdatedAt = Instant.EPOCH;
        private ResourceState worstState = ResourceState.HEALTHY;

        void add(ReputationCell cell, boolean resourceBlocked) {
            cells++;
            if (resourceBlocked) {
                blocked++;
            }
            // cellsByState keeps the cells' own states (the same raw breakdown PoolViewAssembler's summary
            // reports), while worstState folds the resource-wide block in — the rule
            // PoolViewAssembler's per-resource representative already follows. Keeping them separate is
            // what makes both truthful: the breakdown stays a census of cell states, and the headline
            // state cannot read HEALTHY for a context whose only cells sit on blocked resources.
            ResourceState effective = resourceBlocked ? ResourceState.BLOCKLISTED : cell.state();
            if (PoolViewAssembler.severity(effective) > PoolViewAssembler.severity(worstState)) {
                worstState = effective;
            }
            byState.merge(cell.state(), 1, Integer::sum);
            scoreSum += cell.score();
            worstScore = Math.min(worstScore, cell.score());
            bestScore = Math.max(bestScore, cell.score());
            if (cell.updatedAt().isAfter(lastUpdatedAt)) {
                lastUpdatedAt = cell.updatedAt();
            }
        }

        ContextSummary toSummary(String context) {
            Map<String, Integer> cellsByState = new LinkedHashMap<>();
            for (ResourceState state : ResourceState.values()) {
                cellsByState.put(state.name(), byState.getOrDefault(state, 0));
            }
            return new ContextSummary(
                    context,
                    cells,
                    blocked,
                    cellsByState,
                    worstState.name(),
                    scoreSum / cells,
                    worstScore,
                    bestScore,
                    lastUpdatedAt.equals(Instant.EPOCH) ? null : lastUpdatedAt);
        }
    }

    /** Every context the pool currently holds cells for. */
    public record ContextOverview(List<ContextSummary> contexts) {}

    /**
     * One context aggregated over its cells. {@code cells} doubles as the resource count — a context holds
     * at most one cell per resource. {@code lastUpdatedAt} is the newest cell update in this context and is
     * null only if no cell has ever been updated (an unreachable state in practice, kept total for safety).
     *
     * <p>{@code cellsByState} and {@code state} answer different questions and are both needed.
     * {@code cellsByState} is a census of the cells' own states; {@code state} is the headline — the worst
     * severity present, with a resource-wide block counted as {@code BLOCKLISTED} even where the cell
     * itself reads healthy. Deriving the headline from the census instead would let a context whose only
     * cells sit on blocked resources display as {@code HEALTHY}.
     */
    public record ContextSummary(
            String context,
            int cells,
            int blocked,
            Map<String, Integer> cellsByState,
            String state,
            double averageScore,
            double worstScore,
            double bestScore,
            Instant lastUpdatedAt) {}

    /** One context expanded into its resources, worst first. */
    public record ContextDetail(String context, List<ContextResourceRow> resources) {}

    /** One {@code (resource × context)} cell seen from the context side. */
    public record ContextResourceRow(
            String kind,
            String value,
            boolean registered,
            boolean blocked,
            Instant blockedUntil,
            boolean blockPermanent,
            String state,
            double score,
            int consecutiveFailures,
            int consecutiveSuccesses,
            int windowSize,
            boolean[] recentWindow,
            Instant cooldownUntil,
            Instant updatedAt) {}
}
