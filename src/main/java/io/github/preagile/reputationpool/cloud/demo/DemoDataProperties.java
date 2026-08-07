package io.github.preagile.reputationpool.cloud.demo;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Configuration for the read-only demo tenant's seeded data, bound from {@code reputation-pool.demo.*}.
 *
 * <p><b>Off unless asked for.</b> {@link #enabled()} defaults to {@code false}, so a deployment that
 * never mentions these keys writes nothing at all — the same posture
 * {@link io.github.preagile.reputationpool.cloud.security.ApiKeySeeder} takes towards an unset API key.
 * There is no default that quietly materialises a tenant.
 *
 * @param enabled whether to seed the demo tenant on startup; off by default
 * @param tenant the tenant id the seed is confined to — the seeder never writes outside it
 * @param resources how many resources to fabricate (the apparent size of the proxy fleet)
 * @param history how far back the fabricated history reaches from "now"
 * @param steps how many points that history is divided into (score-curve resolution and report cadence)
 * @param usageDays how many days of daily usage meters to fabricate for the usage screen
 * @param seed the PRNG seed — fixed so a re-run reproduces byte-identical data rather than drifting
 */
@ConfigurationProperties("reputation-pool.demo")
public record DemoDataProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("demo") String tenant,
        @DefaultValue("36") int resources,
        @DefaultValue("PT48H") Duration history,
        @DefaultValue("96") int steps,
        @DefaultValue("30") int usageDays,
        @DefaultValue("20260807") long seed) {

    /**
     * Fail fast on a shape that cannot produce data, but only when the seeder is actually on — an
     * operator who leaves these keys alone must never be stopped from starting the app by them
     * (the {@code limits} validation posture, applied narrowly).
     */
    public DemoDataProperties {
        if (enabled) {
            if (tenant == null || tenant.isBlank()) {
                throw new IllegalArgumentException("demo.tenant must not be blank when demo.enabled is true");
            }
            if (resources <= 0) {
                throw new IllegalArgumentException("demo.resources must be > 0, but was " + resources);
            }
            if (steps <= 0) {
                throw new IllegalArgumentException("demo.steps must be > 0, but was " + steps);
            }
            if (usageDays < 0) {
                throw new IllegalArgumentException("demo.usage-days must be >= 0, but was " + usageDays);
            }
            if (history == null || history.isZero() || history.isNegative()) {
                throw new IllegalArgumentException("demo.history must be a positive duration");
            }
        }
    }
}
