package io.github.preagile.reputationpool.cloud.engine;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.core.port.ResourceStore;
import java.time.Clock;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Owns the pool's durable lifecycle, ported from the public {@code AdvisorServer}: restore-on-start
 * (before any traffic), a periodic checkpoint, an opt-in retention purge, and a final checkpoint on
 * orderly shutdown.
 *
 * <p>Implemented as a {@link SmartLifecycle} at a low phase so it starts before the web/gRPC servers
 * (the pool is rehydrated before it can serve a request) and stops after them (the final checkpoint
 * captures a state no longer changing). The audit trail's own bean is closed after this bean during
 * shutdown, so the trail's tail is flushed only after the final save.
 *
 * <p>Both scheduled chores are exception-isolated on purpose: {@code @Scheduled} with a fixed delay
 * keeps running after a failed execution, but swallowing the error here means one bad save or purge is
 * skipped and retried next interval, matching the reference's {@code scheduleAtFixedRate} discipline.
 */
@Component
public class PoolLifecycle implements SmartLifecycle {

    /**
     * Low phase: start before, stop after, the servers. #3's gRPC server will sit at a higher phase so
     * restore precedes traffic and the final checkpoint follows a drained server.
     */
    static final int PHASE = 0;

    private static final Logger log = LoggerFactory.getLogger(PoolLifecycle.class);

    private final ResourcePool pool;
    private final ResourceStore store;
    private final AuditPurger auditPurger;
    private final Clock clock;
    private final ReputationPoolProperties properties;

    private volatile boolean running = false;

    public PoolLifecycle(
            ResourcePool pool,
            ResourceStore store,
            AuditPurger auditPurger,
            Clock clock,
            ReputationPoolProperties properties) {
        this.pool = pool;
        this.store = store;
        this.auditPurger = auditPurger;
        this.clock = clock;
        this.properties = properties;
    }

    /** Rehydrates the pool from the last checkpoint. Empty store means first run — nothing to restore. */
    @Override
    public void start() {
        store.load().ifPresent(pool::restore);
        running = true;
        log.info("reputation pool restored and running");
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
     * Writes the pool's current snapshot to the store. Exception-isolated: a failed save is logged and
     * swallowed so the periodic schedule survives a transient DB error.
     */
    @Scheduled(
            initialDelayString = "${reputation-pool.checkpoint-interval:PT30S}",
            fixedDelayString = "${reputation-pool.checkpoint-interval:PT30S}")
    void checkpoint() {
        try {
            store.save(pool.snapshot());
        } catch (RuntimeException e) {
            log.warn("checkpoint save failed; will retry on the next interval", e);
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
