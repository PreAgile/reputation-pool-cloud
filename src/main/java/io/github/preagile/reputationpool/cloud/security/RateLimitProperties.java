package io.github.preagile.reputationpool.cloud.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Per-tenant request-rate ceiling for the data plane, bound from {@code reputation-pool.rate-limit.*}
 * (issue #132).
 *
 * <p><b>Why this exists now.</b> Until #136 the data plane was reachable only on loopback, so there was
 * no abusable surface and no limiter. Opening {@code report}/{@code acquire} to the internet creates one:
 * every tenant shares a single JVM, so one runaway key degrades everyone else. {@code
 * ReputationPoolProperties.Limits} (issue #84) already bounds *memory* across tenants — it says nothing
 * about request rate, which is a different axis and the one an open endpoint exposes first.
 *
 * <p><b>Why a token bucket rather than the sliding window used by {@link LoginThrottleProperties}.</b>
 * Two reasons. Memory: a sliding window keeps one timestamp per request, which is fine for a login page
 * (a few per minute) and not for a data plane (hundreds per second); a bucket is constant per tenant.
 * Behaviour: scrapers report in bursts, and a bucket is exactly the shape of "cap the average, tolerate
 * a spike" — a window of the same average would reject the spike outright.
 *
 * <p><b>The numbers below are an unmeasured hypothesis.</b> No production traffic has been observed yet
 * (that starts with #137). They are deliberately generous: a ceiling set too low silently throttles the
 * first real customer — which is us — and that failure looks like "the product is slow", not like a
 * limiter doing its job. Tune down once #137 gives real figures.
 *
 * @param enabled master switch. {@code false} makes the interceptor a no-op — the escape hatch when the
 *     limiter itself is suspected of blocking legitimate traffic
 * @param requestsPerSecond sustained rate allowed per tenant, in requests per second
 * @param burst how many requests a tenant may fire back-to-back after an idle period. Also the bucket's
 *     capacity: tokens accrue at {@link #requestsPerSecond} and stop here
 */
@ConfigurationProperties("reputation-pool.rate-limit")
public record RateLimitProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("10") double requestsPerSecond,
        @DefaultValue("50") int burst) {

    /**
     * Fail fast on misconfiguration. Spring binds this at startup, so a bad value aborts the boot with a
     * clear message rather than shipping a limiter that rejects everything: {@code requests-per-second: 0}
     * would refill no tokens, so every tenant would be denied forever once the initial burst ran out —
     * a self-inflicted outage that looks like a product failure.
     */
    public RateLimitProperties {
        if (requestsPerSecond <= 0) {
            throw new IllegalArgumentException(
                    "rate-limit.requests-per-second must be > 0, but was " + requestsPerSecond);
        }
        if (burst < 1) {
            throw new IllegalArgumentException("rate-limit.burst must be >= 1, but was " + burst);
        }
    }
}
