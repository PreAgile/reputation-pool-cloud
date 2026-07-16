package io.github.preagile.reputationpool.cloud.readmodel;

import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceState;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;

/**
 * Turns a {@link PoolSnapshot} (the pool's whole durable state, read via
 * {@code registry.poolFor(tenant).snapshot()}) into the flat, JSON-friendly views the dashboard needs
 * (issue #11). Pure functions of the snapshot plus the read instant — no I/O, no engine coupling — so
 * the read model depends only on the core's published value types, never on how a pool is implemented.
 *
 * <p>A resource can hold several {@link ReputationCell}s (one per context); the overview aggregates
 * per resource, while {@link #detail} expands a single resource into its per-context cells. Two domain
 * sentinels are normalized for the wire: a {@code cooldownUntil} of {@link Instant#EPOCH} ("not
 * cooling") becomes {@code null}, and a permanent block ({@link Instant#MAX}) becomes {@code null}
 * with {@code permanent = true}.
 */
public final class PoolViewAssembler {

    private PoolViewAssembler() {}

    /** KPI summary plus a per-resource overview, aggregating the resource's context cells. */
    public static PoolOverview overview(PoolSnapshot snapshot, Instant now) {
        Map<ResourceState, Integer> byState = new EnumMap<>(ResourceState.class);
        for (ResourceState state : ResourceState.values()) {
            byState.put(state, 0);
        }
        Map<ResourceId, Integer> contextsPerResource = new java.util.HashMap<>();
        for (Map.Entry<CellKey, ReputationCell> entry : snapshot.cells().entrySet()) {
            ReputationCell cell = entry.getValue();
            byState.merge(cell.state(), 1, Integer::sum);
            contextsPerResource.merge(entry.getKey().resource(), 1, Integer::sum);
        }

        // Every resource the snapshot knows: registered, blocklisted, or merely seen in a cell.
        TreeSet<ResourceId> resources = new TreeSet<>((a, b) -> {
            int byKind = a.kind().name().compareTo(b.kind().name());
            return byKind != 0 ? byKind : a.value().compareTo(b.value());
        });
        resources.addAll(snapshot.registered());
        resources.addAll(snapshot.blocklist().entries().keySet());
        resources.addAll(contextsPerResource.keySet());

        List<ResourceOverview> resourceViews = new ArrayList<>();
        int blocklisted = 0;
        for (ResourceId resource : resources) {
            BlockView block = blockOf(snapshot, resource, now);
            if (block.blocked()) {
                blocklisted++;
            }
            resourceViews.add(new ResourceOverview(
                    resource.kind().name(),
                    resource.value(),
                    snapshot.registered().contains(resource),
                    block.blocked(),
                    block.until(),
                    block.permanent(),
                    contextsPerResource.getOrDefault(resource, 0)));
        }

        Map<String, Integer> cellsByState = new java.util.LinkedHashMap<>();
        byState.forEach((state, count) -> cellsByState.put(state.name(), count));
        PoolSummary summary = new PoolSummary(
                snapshot.registered().size(), blocklisted, snapshot.cells().size(), cellsByState);
        return new PoolOverview(summary, resourceViews);
    }

    /** The per-context cells of one resource, or empty if the snapshot has never seen it. */
    public static Optional<ResourceDetail> detail(PoolSnapshot snapshot, ResourceId resource, Instant now) {
        List<CellView> cells = new ArrayList<>();
        for (Map.Entry<CellKey, ReputationCell> entry : snapshot.cells().entrySet()) {
            if (!entry.getKey().resource().equals(resource)) {
                continue;
            }
            ReputationCell cell = entry.getValue();
            cells.add(new CellView(
                    entry.getKey().context().value(),
                    cell.score(),
                    cell.consecutiveFailures(),
                    cell.consecutiveSuccesses(),
                    cell.window().size(),
                    cell.state().name(),
                    cell.cooldownUntil().equals(Instant.EPOCH) ? null : cell.cooldownUntil(),
                    cell.updatedAt()));
        }
        boolean registered = snapshot.registered().contains(resource);
        BlockView block = blockOf(snapshot, resource, now);
        if (cells.isEmpty() && !registered && !block.blocked()) {
            return Optional.empty();
        }
        cells.sort((a, b) -> a.context().compareTo(b.context()));
        return Optional.of(new ResourceDetail(
                resource.kind().name(),
                resource.value(),
                registered,
                block.blocked(),
                block.until(),
                block.permanent(),
                cells));
    }

    private static BlockView blockOf(PoolSnapshot snapshot, ResourceId resource, Instant now) {
        Instant until = snapshot.blocklist().entries().get(resource);
        if (until == null || !now.isBefore(until)) {
            return new BlockView(false, null, false);
        }
        if (until.equals(Instant.MAX)) {
            return new BlockView(true, null, true);
        }
        return new BlockView(true, until, false);
    }

    private record BlockView(boolean blocked, Instant until, boolean permanent) {}

    /** KPI summary plus per-resource rows. */
    public record PoolOverview(PoolSummary summary, List<ResourceOverview> resources) {}

    /** Dashboard KPIs: totals and a cells-by-state breakdown. */
    public record PoolSummary(int registered, int blocklisted, int totalCells, Map<String, Integer> cellsByState) {}

    /** One resource aggregated across its contexts. {@code blockedUntil} is null when permanent/unblocked. */
    public record ResourceOverview(
            String kind,
            String value,
            boolean registered,
            boolean blocked,
            Instant blockedUntil,
            boolean blockPermanent,
            int contexts) {}

    /** One resource expanded into its per-context cells. */
    public record ResourceDetail(
            String kind,
            String value,
            boolean registered,
            boolean blocked,
            Instant blockedUntil,
            boolean blockPermanent,
            List<CellView> cells) {}

    /** A single {@code (resource × context)} cell: reputation, streaks, window size, state, cooldown. */
    public record CellView(
            String context,
            double score,
            int consecutiveFailures,
            int consecutiveSuccesses,
            int windowSize,
            String state,
            Instant cooldownUntil,
            Instant updatedAt) {}
}
