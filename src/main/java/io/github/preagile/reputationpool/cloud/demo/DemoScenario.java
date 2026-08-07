package io.github.preagile.reputationpool.cloud.demo;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.Outcome;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.engine.AdaptiveCooldownPolicy;
import io.github.preagile.reputationpool.core.engine.ReputationEngine;
import io.github.preagile.reputationpool.core.pool.Lease;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.pool.WeightedRandomSelectionStrategy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Random;

/**
 * Fabricates the demo tenant's history by <em>running the real engine</em> over a scripted workload,
 * rather than writing plausible-looking numbers into tables.
 *
 * <p><b>Why replay instead of hand-written rows.</b> Everything the console shows — a cell's score, its
 * state, when its cooldown ends, which events were emitted and in what order — is derived by
 * {@code core}'s {@link ReputationEngine} and {@link ResourcePool} from a sequence of outcomes. Inventing
 * those numbers directly would mean reimplementing the engine's rules in cloud (which AGENTS.md forbids)
 * and would drift out of agreement with them the moment upstream retunes a penalty or a cooldown base.
 * So this builds a throwaway pool wired exactly like a production one — same engine, same policy, same
 * configured window/cool/recover knobs — pushes a scripted outcome stream through it, and keeps whatever
 * the engine produced. The seeded data is therefore self-consistent by construction: a curve that dips
 * dips because failures were reported, and the cooldown that follows is the one the real policy computes.
 *
 * <p><b>Backdated, not stamped "now".</b> The pool reads time from an injected {@link Clock}; this
 * advances that clock from {@code now - history} to {@code now} in {@code steps} ticks, so the emitted
 * events carry genuinely spread-out {@code at()} instants and each tick's snapshot is a real point on the
 * score curve. That is the only way to get a history a restart cannot distinguish from a lived-through
 * one — the engine will not backdate for you.
 *
 * <p><b>Deterministic.</b> The PRNG is seeded from configuration, so the same inputs produce the same
 * dataset. Re-seeding is then a replace of identical content, which is what makes the seeder idempotent
 * (see {@link DemoDataSeeder}).
 *
 * <p><b>What cannot be fabricated.</b> Leases live in the pool's in-memory {@code LeaseRegistry} and are
 * absent from {@link PoolSnapshot}, so held leases do not survive into the seeded tenant — only the
 * lease <em>events</em> and the aggregate usage counters do. See {@link Dataset#usage()}.
 */
public final class DemoScenario {

    /** The platforms a resource is judged against — the {@code context} axis of the resource × context grid. */
    private static final List<String> PLATFORMS = List.of(
            "shop.example-mall.com",
            "search.example-portal.com",
            "api.example-pay.com",
            "feed.example-social.com",
            "login.example-bank.com");

    /** Proxy regions, so the fabricated fleet reads like one that was provisioned rather than numbered. */
    private static final List<String> REGIONS = List.of("ap-seoul", "ap-tokyo", "us-east", "us-west", "eu-west");

    /**
     * How a resource behaves over the window. The mix is what puts every state on screen at once: mostly
     * good resources, a chronically flaky minority, some that are failing right now, and some that just
     * came back.
     */
    private enum Profile {
        /** Almost always succeeds — ends HEALTHY with a high score. */
        RELIABLE,
        /** Fails often but not consistently — ends mid-score, states churn. */
        FLAKY,
        /** Was fine, is failing now — ends COOLING with a long cooldown still running. */
        DEGRADING,
        /** Was failing, is coming back — ends RECOVERING on its first success after a cooldown. */
        RECOVERING
    }

    private DemoScenario() {}

    /** One fabricated score point, the shape {@code score_sample} stores and the 24h curve plots. */
    public record ScoreSample(ResourceId resource, Context context, Instant at, double score) {}

    /** One day's granted-lease count, the shape {@code usage_meter}'s {@code lease} metric accumulates. */
    public record DailyUsage(LocalDate day, long leases) {}

    /**
     * Everything one seeded tenant consists of: the pool state the dashboard reads live, the ledger the
     * event feed pages, the time series the curve plots, and the meters the usage screen totals.
     */
    public record Dataset(
            PoolSnapshot snapshot, List<PoolEvent> events, List<ScoreSample> samples, List<DailyUsage> usage) {}

    /**
     * Replays the scripted workload and returns what the engine made of it.
     *
     * @param demo the shape of the fabricated history (size, window, resolution, PRNG seed)
     * @param engineProps the running engine's own tuning — reused so the seeded curve obeys the same
     *     window/cool/recover rules the live pool will apply to any traffic that follows
     * @param now the instant the history ends at (the demo's "present")
     */
    public static Dataset build(DemoDataProperties demo, ReputationPoolProperties engineProps, Instant now) {
        Objects.requireNonNull(demo, "demo must not be null");
        Objects.requireNonNull(engineProps, "engineProps must not be null");
        Objects.requireNonNull(now, "now must not be null");

        List<PoolEvent> events = new ArrayList<>();
        Ticker ticker = new Ticker(now.minus(demo.history()));
        ResourcePool pool = new ResourcePool(
                new ReputationEngine(
                        new AdaptiveCooldownPolicy(),
                        engineProps.engine().windowSize(),
                        engineProps.engine().coolAfter(),
                        engineProps.engine().recoverAfter()),
                new WeightedRandomSelectionStrategy(),
                events::add,
                ticker,
                new Random(demo.seed()),
                engineProps.leaseTtl());

        Random random = new Random(demo.seed());
        List<ResourceId> resources = resources(demo.resources());
        List<List<Context>> contexts = contextsPerResource(resources.size());

        // A cold start before anything is registered: acquire finds nothing to lend, which is the one
        // honest way to get AcquisitionRejected into the feed (it needs an empty selectable set).
        for (int i = 0; i < 3; i++) {
            pool.acquire(new Context(PLATFORMS.get(i % PLATFORMS.size())));
            ticker.advance(Duration.ofSeconds(7));
        }
        resources.forEach(pool::register);

        List<ScoreSample> samples = new ArrayList<>();
        Duration tick = demo.history().dividedBy(demo.steps());
        for (int step = 1; step <= demo.steps(); step++) {
            ticker.set(now.minus(demo.history()).plus(tick.multipliedBy(step)));
            reportAll(pool, resources, contexts, random, step, demo.steps());
            exerciseLeases(pool, random);
            applyOperatorBlocks(pool, resources, step, demo.steps());
            collect(samples, pool.snapshot(), ticker.instant());
        }
        // Land exactly on `now` so the newest sample and the newest event are current, not one tick stale.
        ticker.set(now);

        return new Dataset(
                pool.snapshot(), List.copyOf(events), List.copyOf(samples), usage(demo, resources.size(), now));
    }

    /** A fleet that reads like provisioned infrastructure: mostly proxies, some accounts, a few sessions. */
    private static List<ResourceId> resources(int count) {
        List<ResourceId> ids = new ArrayList<>(count);
        int proxies = Math.max(1, count * 2 / 3);
        int accounts = Math.max(1, count / 5);
        for (int i = 0; i < count; i++) {
            if (i < proxies) {
                ids.add(new ResourceId(
                        ResourceKind.PROXY, "proxy-%s-%02d".formatted(REGIONS.get(i % REGIONS.size()), i + 1)));
            } else if (i < proxies + accounts) {
                ids.add(new ResourceId(ResourceKind.ACCOUNT, "acct-crawler-%02d".formatted(i - proxies + 1)));
            } else {
                ids.add(new ResourceId(
                        ResourceKind.SESSION, "sess-residential-%02d".formatted(i - proxies - accounts + 1)));
            }
        }
        return List.copyOf(ids);
    }

    /**
     * Which platforms each resource is exercised against: 1–4 of them, starting at a rotating offset, so
     * the resource × context grid is genuinely sparse in places and dense in others rather than square.
     */
    private static List<List<Context>> contextsPerResource(int resourceCount) {
        List<List<Context>> perResource = new ArrayList<>(resourceCount);
        for (int i = 0; i < resourceCount; i++) {
            List<Context> assigned = new ArrayList<>();
            for (int c = 0; c <= i % 4; c++) {
                assigned.add(new Context(PLATFORMS.get((i + c) % PLATFORMS.size())));
            }
            perResource.add(List.copyOf(assigned));
        }
        return List.copyOf(perResource);
    }

    private static Profile profileOf(int index) {
        // 40% reliable / 20% each of the rest — a fleet where most things work and a minority does not.
        return switch (index % 5) {
            case 0, 1 -> Profile.RELIABLE;
            case 2 -> Profile.FLAKY;
            case 3 -> Profile.DEGRADING;
            default -> Profile.RECOVERING;
        };
    }

    private static void reportAll(
            ResourcePool pool,
            List<ResourceId> resources,
            List<List<Context>> contexts,
            Random random,
            int step,
            int steps) {
        for (int i = 0; i < resources.size(); i++) {
            for (Context context : contexts.get(i)) {
                pool.report(resources.get(i), context, outcome(profileOf(i), random, step, steps));
            }
        }
    }

    /**
     * The outcome a resource of this profile reports at this point in the window.
     *
     * <p>The tail of the window is scripted rather than sampled, because "what the console shows right
     * now" is the whole point of the demo and a coin flip cannot be relied on to leave a cell in the
     * state the screen needs to demonstrate. A DEGRADING resource's last two reports are {@code BLOCKED}
     * failures, whose cooldown (base 1h, doubled at the second consecutive failure) is still running at
     * {@code now} — so it is genuinely COOLING, computed by the policy, not asserted. A RECOVERING
     * resource fails just before the end and then succeeds once after that cooldown has lapsed, which is
     * exactly the transition the engine turns into RECOVERING.
     */
    private static Outcome outcome(Profile profile, Random random, int step, int steps) {
        double progress = (double) step / steps;
        if (profile == Profile.DEGRADING && step > steps - 2) {
            return new Outcome.Failure(FailureType.BLOCKED, Duration.ofMillis(120 + random.nextInt(80)));
        }
        if (profile == Profile.RECOVERING) {
            if (step == steps - 2 || step == steps - 1) {
                return new Outcome.Failure(FailureType.TIMEOUT, Duration.ofMillis(2500 + random.nextInt(900)));
            }
            if (step == steps) {
                return new Outcome.Success(Duration.ofMillis(180 + random.nextInt(220)));
            }
        }
        double failureProbability =
                switch (profile) {
                    case RELIABLE -> 0.03;
                    case FLAKY -> 0.22;
                    case DEGRADING -> 0.05 + 0.5 * progress;
                    case RECOVERING -> 0.55 - 0.5 * progress;
                };
        if (random.nextDouble() >= failureProbability) {
            return new Outcome.Success(Duration.ofMillis(120 + random.nextInt(400)));
        }
        FailureType type = FAILURE_TYPES.get(random.nextInt(FAILURE_TYPES.size()));
        return new Outcome.Failure(type, Duration.ofMillis(900 + random.nextInt(3000)));
    }

    /** Weighted by repetition: timeouts and slowness dominate real proxy fleets; hard blocks are rarer. */
    private static final List<FailureType> FAILURE_TYPES = List.of(
            FailureType.TIMEOUT,
            FailureType.TIMEOUT,
            FailureType.SLOW,
            FailureType.SLOW,
            FailureType.CONNECTION_RESET,
            FailureType.TLS_HANDSHAKE,
            FailureType.BLOCKED);

    /** A couple of lease/release round trips per tick, so the feed carries traffic and not only incidents. */
    private static void exerciseLeases(ResourcePool pool, Random random) {
        for (int i = 0; i < 2; i++) {
            Optional<Lease> lease = pool.acquire(new Context(PLATFORMS.get(random.nextInt(PLATFORMS.size()))));
            lease.ifPresent(pool::release);
        }
    }

    /**
     * Operator interventions spread across the window: two resources blocked permanently, one blocked for
     * a while and then released. These are the only source of BLOCKLISTED — the engine never blocklists on
     * its own — so without them the console's block column is dead.
     */
    private static void applyOperatorBlocks(ResourcePool pool, List<ResourceId> resources, int step, int steps) {
        if (resources.size() < 4) {
            return;
        }
        if (step == steps * 3 / 10) {
            pool.blockPermanently(resources.get(resources.size() - 1));
        }
        if (step == steps / 2) {
            pool.block(resources.get(resources.size() - 2), Duration.ofHours(6));
        }
        if (step == steps * 6 / 10) {
            pool.blockPermanently(resources.get(resources.size() - 3));
        }
        if (step == steps * 8 / 10) {
            // Released again, so the timeline shows an intervention being undone and not only imposed.
            pool.unblock(resources.get(resources.size() - 2));
        }
    }

    private static void collect(List<ScoreSample> samples, PoolSnapshot snapshot, Instant at) {
        for (Map.Entry<CellKey, ReputationCell> entry : snapshot.cells().entrySet()) {
            samples.add(new ScoreSample(
                    entry.getKey().resource(),
                    entry.getKey().context(),
                    at,
                    entry.getValue().score()));
        }
    }

    /**
     * Daily granted-lease counts for the usage screen. Unlike the pool state these are plain counters with
     * no engine semantics to honour, so they are generated directly — with a weekday/weekend rhythm and a
     * mild upward trend, and today deliberately short because the day is not over.
     */
    private static List<DailyUsage> usage(DemoDataProperties demo, int resourceCount, Instant now) {
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        Random random = new Random(demo.seed() + 1);
        List<DailyUsage> usage = new ArrayList<>(demo.usageDays());
        for (int back = demo.usageDays() - 1; back >= 0; back--) {
            LocalDate day = today.minusDays(back);
            double trend = 1.0 + 0.012 * (demo.usageDays() - 1 - back);
            double weekly =
                    switch (day.getDayOfWeek()) {
                        case SATURDAY, SUNDAY -> 0.55;
                        case MONDAY -> 1.15;
                        default -> 1.0;
                    };
            double partialDay = back == 0 ? partOfDayElapsed(now) : 1.0;
            long leases =
                    Math.round(resourceCount * 240.0 * trend * weekly * partialDay * (0.9 + 0.2 * random.nextDouble()));
            usage.add(new DailyUsage(day, leases));
        }
        return List.copyOf(usage);
    }

    /** How much of the current UTC day has elapsed, so today's meter reads like a day in progress. */
    private static double partOfDayElapsed(Instant now) {
        long secondsIntoDay = now.atZone(ZoneOffset.UTC).toLocalTime().toSecondOfDay();
        return Math.max(0.05, secondsIntoDay / 86_400.0);
    }

    /**
     * A clock the replay drives by hand. {@link ResourcePool} takes its {@code now} from whatever clock it
     * was built with, so this is what lets the fabricated history be dated in the past — there is no
     * "emit this event at time T" entry point on the pool.
     */
    private static final class Ticker extends Clock {

        private Instant now;

        private Ticker(Instant start) {
            this.now = start;
        }

        private void set(Instant at) {
            this.now = at;
        }

        private void advance(Duration by) {
            this.now = this.now.plus(by);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
