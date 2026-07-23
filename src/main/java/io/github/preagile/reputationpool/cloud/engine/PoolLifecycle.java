package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.engine.PerTenantPoolRegistry.ManagedPool;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import java.time.Clock;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Owns the durable lifecycle of every tenant's pool, ported from the public {@code AdvisorServer}:
 * restore-on-start (before any traffic), a periodic checkpoint, an opt-in retention purge, and a final
 * checkpoint on orderly shutdown. Where the reference drives one pool, this fans each chore out across
 * the {@link PerTenantPoolRegistry}'s per-tenant pools.
 *
 * <p>Implemented as a {@link SmartLifecycle} at a low phase so it starts before the web/gRPC servers
 * (pools are rehydrated before they can serve a request) and stops after them (the final checkpoint
 * captures a state no longer changing). The audit trail's own bean is closed after this bean during
 * shutdown, so the trail's tail is flushed only after the final save.
 *
 * <p><b>Per-tenant exception isolation.</b> Both the restore fan-out and the checkpoint fan-out isolate
 * failures per tenant: one tenant's DB error is logged and skipped so it never blocks another tenant's
 * restore or checkpoint. That is on top of the whole-chore isolation the reference already has —
 * {@code @Scheduled} with a fixed delay keeps running after a failed execution, and swallowing here
 * means a bad interval is skipped and retried next time.
 */
@Component
public class PoolLifecycle implements SmartLifecycle {

    /**
     * Low phase: start before, stop after, the servers, so restore precedes traffic and the final
     * checkpoint follows a drained server.
     */
    static final int PHASE = 0;

    private static final Logger log = LoggerFactory.getLogger(PoolLifecycle.class);

    private final PerTenantPoolRegistry registry;
    private final AuditPurger auditPurger;
    private final Clock clock;
    private final ReputationPoolProperties properties;
    private final GlobalResourceBudget budget;

    private volatile boolean running = false;

    public PoolLifecycle(
            PerTenantPoolRegistry registry,
            AuditPurger auditPurger,
            Clock clock,
            ReputationPoolProperties properties,
            GlobalResourceBudget budget) {
        this.registry = registry;
        this.auditPurger = auditPurger;
        this.clock = clock;
        this.properties = properties;
        this.budget = budget;
    }

    /**
     * Rehydrates every known tenant's pool from its last checkpoint, before any traffic. Each tenant is
     * built (materializing its pool + store) and restored independently, so one tenant's failed load
     * never blocks the rest. A tenant with no saved snapshot is a first run — nothing to restore.
     *
     * <p>The resources and cells restored across all tenants are then folded into the
     * {@link GlobalResourceBudget} in one pass, so the OOM guard resumes from the real occupancy rather
     * than zero — otherwise a restart would restore the previous state into the heap yet let the process
     * admit a full ceiling's worth of new resources on top. The tally reuses the {@code PoolSnapshot} each
     * {@code load()} already returned (never re-snapshotting the pool), and is applied once after the loop.
     */
    @Override
    public void start() {
        long restoredResources = 0;
        long restoredCells = 0;
        for (String tenantId : registry.knownTenantIds()) {
            try {
                ManagedPool managed = registry.manage(tenantId);
                var loaded = managed.store().load();
                if (loaded.isPresent()) {
                    PoolSnapshot snapshot = loaded.get();
                    managed.pool().restore(snapshot);
                    restoredResources += snapshot.registered().size();
                    restoredCells += snapshot.cells().size();
                }
            } catch (RuntimeException e) {
                log.warn("restore failed for tenant {}; continuing with the other tenants", tenantId, e);
            }
        }
        budget.accountForExisting(restoredResources, restoredCells);
        running = true;
        log.info(
                "reputation pools restored and running; accounted {} resources and {} cells into the global budget",
                restoredResources,
                restoredCells);
    }

    /** Orderly shutdown: one final checkpoint of the now-stable state so a planned restart loses nothing. */
    @Override
    public void stop() {
        checkpoint();
        running = false;
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return PHASE;
    }

    /**
     * Writes each tenant's current snapshot to its own store. Isolated per tenant and as a whole: a
     * failed save is logged and swallowed so one tenant's transient DB error neither aborts the other
     * tenants' checkpoints nor cancels the periodic schedule.
     */
    @Scheduled(
            initialDelayString = "${reputation-pool.checkpoint-interval:PT30S}",
            fixedDelayString = "${reputation-pool.checkpoint-interval:PT30S}")
    void checkpoint() {
        for (ManagedPool managed : registry.managedPools()) {
            try {
                managed.store().save(managed.pool().snapshot());
            } catch (RuntimeException e) {
                log.warn(
                        "checkpoint save failed for tenant {}; will retry on the next interval", managed.tenantId(), e);
            }
        }
    }

    /**
     * Trims the audit trail to the configured retention, if any. No positive retention means no purge —
     * the trail grows unbounded, exactly as the reference does when the knob is unset. Exception-isolated
     * for the same reason as {@link #checkpoint()}.
     */
    @Scheduled(
            initialDelayString = "${reputation-pool.audit.purge-interval:PT1H}",
            fixedDelayString = "${reputation-pool.audit.purge-interval:PT1H}")
    void purgeExpiredAuditEvents() {
        ReputationPoolProperties.Audit audit = properties.audit();
        if (!audit.purgeEnabled()) {
            return;
        }
        Duration retention = audit.retention();
        try {
            long purged = auditPurger.purgeOlderThan(clock.instant().minus(retention));
            if (purged > 0) {
                log.info("audit retention purged {} events older than {}", purged, retention);
            }
        } catch (RuntimeException e) {
            log.warn("audit purge failed; will retry on the next interval", e);
        }
    }
}
