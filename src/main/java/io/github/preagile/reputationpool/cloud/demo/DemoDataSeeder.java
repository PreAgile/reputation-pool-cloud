package io.github.preagile.reputationpool.cloud.demo;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.demo.DemoScenario.DailyUsage;
import io.github.preagile.reputationpool.cloud.demo.DemoScenario.Dataset;
import io.github.preagile.reputationpool.cloud.demo.DemoScenario.ScoreSample;
import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry.ManagedPool;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Materialises the read-only demo tenant on startup: one tenant whose pool, ledger, score series and
 * usage meters look like a service that has been running, so the console can be shown to someone without
 * a live customer's data and without anyone needing write access to produce it.
 *
 * <p><b>Off by default.</b> Nothing happens unless {@code reputation-pool.demo.enabled} is explicitly
 * true — the {@link io.github.preagile.reputationpool.cloud.security.ApiKeySeeder} posture: an unset knob
 * writes nothing rather than conjuring a default.
 *
 * <p><b>Confined to one tenant.</b> Every statement here is keyed by the configured demo tenant
 * ({@code tenant_id} / {@code pool_id}), and the snapshot write goes through that tenant's own
 * {@code PostgresResourceStore}, which is itself namespaced to its {@code pool_id}. No statement in this
 * class can reach another tenant's row.
 *
 * <p><b>It refuses to seed over a tenant it did not create.</b> The tenant id is a plain configuration
 * string, so a typo could otherwise point a destructive replace at a real customer. The seeder therefore
 * proceeds only when the tenant row is absent (it creates it) or already carries {@link #DEMO_TENANT_NAME}
 * — anything else is left untouched and logged. That check is what makes the "replace" strategy below
 * safe to run unattended.
 *
 * <p><b>Idempotent by replacement.</b> Re-running deletes exactly this tenant's seeded rows and writes
 * the dataset again. Because {@link DemoScenario} is deterministic, a second run produces the same
 * content rather than a second copy — the row count after N startups equals the row count after one. The
 * three table writes share one transaction so a failure part-way cannot leave the console showing a
 * ledger without the state that produced it. The history is re-anchored to the current instant on every
 * run, which is what stops the demo from visibly ageing.
 *
 * <p><b>On writing {@code audit_event} directly.</b> The upstream {@code PostgresAuditTrail} is an
 * asynchronous, bounded-queue sink with no flush seam, so it cannot be used to write a backdated batch
 * transactionally. Cloud already owns the symmetric read half of this table — {@code AuditEventReader}
 * decodes the same columns and the same epoch-nanosecond encoding — so the encode here is that same
 * contract in the other direction, not a new coupling.
 *
 * <p><b>What is deliberately not seeded.</b> Live lease occupancy: {@code LeaseRegistry} is in-memory and
 * absent from {@code PoolSnapshot}, so a lease cannot be restored from the database by any means. The
 * demo shows lease <em>events</em> in the feed and lease <em>counts</em> on the usage screen; it does not
 * show resources currently held.
 */
public final class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    /**
     * The marker the seeder stamps on the tenant row and requires to see before overwriting anything.
     * It is the guard against a mistyped tenant id turning this into a data-loss tool.
     */
    static final String DEMO_TENANT_NAME = "Demo (seeded)";

    private static final String SELECT_TENANT = "SELECT name FROM tenant WHERE id = ?";
    private static final String INSERT_TENANT =
            "INSERT INTO tenant (id, name, status, created_at) VALUES (?, ?, 'active', ?) ON CONFLICT (id) DO NOTHING";
    private static final String ACTIVATE_TENANT = "UPDATE tenant SET status = 'active' WHERE id = ? AND name = ?";

    private static final String DELETE_EVENTS = "DELETE FROM audit_event WHERE pool_id = ?";
    private static final String INSERT_EVENT = "INSERT INTO audit_event"
            + " (pool_id, event_type, resource_kind, resource_value, context, occurred_at, until, cause)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

    private static final String DELETE_SAMPLES = "DELETE FROM score_sample WHERE tenant_id = ?";
    private static final String INSERT_SAMPLE = "INSERT INTO score_sample"
            + " (tenant_id, resource_kind, resource_value, context, sampled_at, score) VALUES (?, ?, ?, ?, ?, ?)";

    private static final String DELETE_METERS = "DELETE FROM usage_meter WHERE tenant_id = ?";
    private static final String INSERT_METER =
            "INSERT INTO usage_meter" + " (tenant_id, metric, period_start, value, updated_at) VALUES (?, ?, ?, ?, ?)";

    /** Epoch-nanosecond bigint is the audit ledger's lossless time column (upstream V2's decision). */
    private static final long NANOS_PER_SECOND = 1_000_000_000L;

    private final DataSource dataSource;
    private final DemoDataProperties demo;
    private final ReputationPoolProperties engineProperties;
    private final PerTenantPoolRegistry registry;
    private final GlobalResourceBudget budget;
    private final Clock clock;

    public DemoDataSeeder(
            DataSource dataSource,
            DemoDataProperties demo,
            ReputationPoolProperties engineProperties,
            PerTenantPoolRegistry registry,
            GlobalResourceBudget budget,
            Clock clock) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource must not be null");
        this.demo = Objects.requireNonNull(demo, "demo must not be null");
        this.engineProperties = Objects.requireNonNull(engineProperties, "engineProperties must not be null");
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.budget = Objects.requireNonNull(budget, "budget must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @Override
    public void run(ApplicationArguments args) throws SQLException {
        if (!demo.enabled()) {
            return;
        }
        String tenantId = demo.tenant();
        try (Connection connection = dataSource.getConnection()) {
            if (!claimTenant(connection, tenantId)) {
                log.warn(
                        "demo seeding skipped: tenant '{}' exists but was not created by the demo seeder — refusing to"
                                + " overwrite it. Point reputation-pool.demo.tenant at an unused id.",
                        tenantId);
                return;
            }
            Dataset dataset = DemoScenario.build(demo, engineProperties, clock.instant());
            writeAll(connection, tenantId, dataset);
            publish(tenantId, dataset);
            log.info(
                    "demo tenant '{}' seeded: {} resources, {} cells, {} events, {} score samples, {} usage days",
                    tenantId,
                    dataset.snapshot().registered().size(),
                    dataset.snapshot().cells().size(),
                    dataset.events().size(),
                    dataset.samples().size(),
                    dataset.usage().size());
        }
    }

    /**
     * Ensures the tenant row exists and is one this seeder owns, returning whether seeding may proceed.
     * The insert is {@code ON CONFLICT DO NOTHING} so two instances starting together converge instead of
     * one failing on a duplicate key (the {@code ApiKeySeeder} concurrency posture); the re-read after it
     * is what decides, so a row that lost the race is still checked for the marker rather than assumed.
     */
    private boolean claimTenant(Connection connection, String tenantId) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement(INSERT_TENANT)) {
            insert.setString(1, tenantId);
            insert.setString(2, DEMO_TENANT_NAME);
            insert.setTimestamp(3, Timestamp.from(clock.instant()));
            insert.executeUpdate();
        }
        if (!DEMO_TENANT_NAME.equals(existingName(connection, tenantId).orElse(null))) {
            return false;
        }
        // A demo tenant that was suspended (or left suspended by an earlier experiment) would be refused by
        // TenantStatusFilter on every call, so the console would be empty for reasons no screen explains.
        try (PreparedStatement activate = connection.prepareStatement(ACTIVATE_TENANT)) {
            activate.setString(1, tenantId);
            activate.setString(2, DEMO_TENANT_NAME);
            activate.executeUpdate();
        }
        return true;
    }

    private static Optional<String> existingName(Connection connection, String tenantId) throws SQLException {
        try (PreparedStatement select = connection.prepareStatement(SELECT_TENANT)) {
            select.setString(1, tenantId);
            try (var rows = select.executeQuery()) {
                return rows.next() ? Optional.ofNullable(rows.getString(1)) : Optional.empty();
            }
        }
    }

    /** One transaction over all three tables, so a half-written demo is never visible to the console. */
    private void writeAll(Connection connection, String tenantId, Dataset dataset) throws SQLException {
        boolean autoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try {
            replaceEvents(connection, tenantId, dataset.events());
            replaceSamples(connection, tenantId, dataset.samples());
            replaceMeters(connection, tenantId, dataset);
            connection.commit();
        } catch (SQLException | RuntimeException e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(autoCommit);
        }
    }

    private static void replaceEvents(Connection connection, String tenantId, List<PoolEvent> events)
            throws SQLException {
        deleteScoped(connection, DELETE_EVENTS, tenantId);
        try (PreparedStatement insert = connection.prepareStatement(INSERT_EVENT)) {
            for (PoolEvent event : events) {
                insert.setString(1, tenantId);
                bindEvent(insert, event);
                insert.addBatch();
            }
            insert.executeBatch();
        }
    }

    /**
     * The wide-table encoding upstream's V2/V4 schema defines: an {@code event_type} discriminator plus
     * whichever of {@code resource}/{@code context}/{@code until}/{@code cause} the case carries, with the
     * rest null. {@code until} is null for a permanent block ({@link Instant#MAX}), the same convention
     * {@code blocklist_entry} uses.
     */
    private static void bindEvent(PreparedStatement insert, PoolEvent event) throws SQLException {
        switch (event) {
            case PoolEvent.ResourceCooled e ->
                bind(
                        insert,
                        "RESOURCE_COOLED",
                        e.resource(),
                        e.context().value(),
                        e.at(),
                        e.until(),
                        e.cause().name());
            case PoolEvent.ResourceRecovered e ->
                bind(insert, "RESOURCE_RECOVERED", e.resource(), e.context().value(), e.at(), null, null);
            case PoolEvent.ResourceBlocklisted e ->
                bind(insert, "RESOURCE_BLOCKLISTED", e.resource(), null, e.at(), e.until(), null);
            case PoolEvent.ResourceUnblocked e ->
                bind(insert, "RESOURCE_UNBLOCKED", e.resource(), null, e.at(), null, null);
            case PoolEvent.ResourceLeased e ->
                bind(insert, "RESOURCE_LEASED", e.resource(), e.context().value(), e.at(), e.until(), null);
            case PoolEvent.LeaseReleased e ->
                bind(insert, "LEASE_RELEASED", e.resource(), e.context().value(), e.at(), null, null);
            case PoolEvent.AcquisitionRejected e ->
                bind(insert, "ACQUISITION_REJECTED", null, e.context().value(), e.at(), null, null);
            default ->
                throw new IllegalStateException(
                        "unmapped pool event " + event.getClass().getName());
        }
    }

    private static void bind(
            PreparedStatement insert,
            String eventType,
            ResourceId resource,
            String context,
            Instant occurredAt,
            Instant until,
            String cause)
            throws SQLException {
        insert.setString(2, eventType);
        setNullable(insert, 3, resource == null ? null : resource.kind().name());
        setNullable(insert, 4, resource == null ? null : resource.value());
        setNullable(insert, 5, context);
        insert.setLong(6, toEpochNanos(occurredAt));
        if (until == null || Instant.MAX.equals(until)) {
            insert.setNull(7, Types.BIGINT);
        } else {
            insert.setLong(7, toEpochNanos(until));
        }
        setNullable(insert, 8, cause);
    }

    private static void setNullable(PreparedStatement insert, int index, String value) throws SQLException {
        if (value == null) {
            insert.setNull(index, Types.VARCHAR);
        } else {
            insert.setString(index, value);
        }
    }

    private static long toEpochNanos(Instant instant) {
        return Math.addExact(Math.multiplyExact(instant.getEpochSecond(), NANOS_PER_SECOND), instant.getNano());
    }

    private static void replaceSamples(Connection connection, String tenantId, List<ScoreSample> samples)
            throws SQLException {
        deleteScoped(connection, DELETE_SAMPLES, tenantId);
        try (PreparedStatement insert = connection.prepareStatement(INSERT_SAMPLE)) {
            for (ScoreSample sample : samples) {
                insert.setString(1, tenantId);
                insert.setString(2, sample.resource().kind().name());
                insert.setString(3, sample.resource().value());
                insert.setString(4, sample.context().value());
                insert.setTimestamp(5, Timestamp.from(sample.at()));
                insert.setDouble(6, sample.score());
                insert.addBatch();
            }
            insert.executeBatch();
        }
    }

    /**
     * The two metrics the usage screen reads: the daily {@code lease} counter series, and today's
     * {@code pool_size} gauge (which the live {@code MeteringRollup} will keep re-sampling at the same
     * value, since it samples this very pool).
     */
    private static void replaceMeters(Connection connection, String tenantId, Dataset dataset) throws SQLException {
        deleteScoped(connection, DELETE_METERS, tenantId);
        Timestamp now = Timestamp.from(Instant.now());
        try (PreparedStatement insert = connection.prepareStatement(INSERT_METER)) {
            for (DailyUsage day : dataset.usage()) {
                insert.setString(1, tenantId);
                insert.setString(2, "lease");
                insert.setObject(3, day.day());
                insert.setLong(4, day.leases());
                insert.setTimestamp(5, now);
                insert.addBatch();
            }
            if (!dataset.usage().isEmpty()) {
                insert.setString(1, tenantId);
                insert.setString(2, "pool_size");
                insert.setObject(
                        3, dataset.usage().get(dataset.usage().size() - 1).day());
                insert.setLong(4, dataset.snapshot().registered().size());
                insert.setTimestamp(5, now);
                insert.addBatch();
            }
            insert.executeBatch();
        }
    }

    private static void deleteScoped(Connection connection, String sql, String tenantId) throws SQLException {
        try (PreparedStatement delete = connection.prepareStatement(sql)) {
            delete.setString(1, tenantId);
            delete.executeUpdate();
        }
    }

    /**
     * Makes the fabricated state the tenant's live state: restored into its in-memory pool (what the
     * dashboard's overview and detail screens read) and written through its own tenant-scoped store (so a
     * restart rehydrates it, and so the periodic checkpoint has something to agree with rather than an
     * empty pool to overwrite it with).
     *
     * <p>The occupancy change is folded into the shared budget for the same reason
     * {@code PoolLifecycle.start} folds in what it restored: otherwise these resources and cells occupy
     * the heap without occupying the ceiling that protects it. It is a <em>delta</em>, not the whole
     * snapshot, because on a restart the lifecycle has already accounted for the previous seed it
     * rehydrated a moment ago — adding the full amount again would double-count this tenant every boot.
     */
    private void publish(String tenantId, Dataset dataset) {
        ManagedPool managed = registry.manage(tenantId);
        PoolSnapshot before = managed.pool().snapshot();
        managed.pool().restore(dataset.snapshot());
        managed.store().save(dataset.snapshot());

        long resourceDelta = (long) dataset.snapshot().registered().size()
                - before.registered().size();
        long cellDelta =
                (long) dataset.snapshot().cells().size() - before.cells().size();
        budget.accountForExisting(Math.max(0, resourceDelta), Math.max(0, cellDelta));
        budget.release(Math.max(0, -resourceDelta), Math.max(0, -cellDelta));
    }
}
