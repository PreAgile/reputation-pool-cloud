package io.github.preagile.reputationpool.cloud.engine;

import java.time.Instant;

/**
 * The audit-trail purge seam: delete every event strictly older than {@code cutoff} and report how
 * many rows went. In production this is backed by {@code PostgresAuditTrail::purgeOlderThan}; the
 * lifecycle's unit tests substitute a recording lambda and stay Docker-free — the same pattern the
 * reference server uses with its {@code AuditRetention.Purger}. Keeping it an interface (rather than
 * depending on the concrete {@code PostgresAuditTrail}) is what lets {@link PoolLifecycle} be tested
 * without a database.
 */
@FunctionalInterface
public interface AuditPurger {

    /**
     * Deletes everything strictly older than {@code cutoff}.
     *
     * @param cutoff the exclusive age boundary; rows stamped before it are purged
     * @return the number of rows deleted
     */
    long purgeOlderThan(Instant cutoff);
}
