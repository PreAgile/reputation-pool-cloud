package io.github.preagile.reputationpool.cloud.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Brute-force defence for the admin login, bound from {@code reputation-pool.admin.login-throttle.*}
 * (issue #28). The single public control-plane endpoint {@code POST /api/auth/login} is the only place
 * an attacker can guess the admin password, so it is throttled per source IP with a short temporary
 * block once the attempts run out.
 *
 * <p><b>Why IP-based, not account lockout.</b> v1 is a single admin login (see {@link
 * AdminAuthProperties}); locking <em>the account</em> after N failures would let anyone who can reach
 * the endpoint deny the real operator access (a self-DoS). So the limiter counts failures per client IP
 * and blocks only that IP for {@link #blockDuration}, never the account.
 *
 * <p>Two layers: (L1) per-IP sliding window — more than {@link #maxAttempts} failed logins inside
 * {@link #window} blocks that IP for {@link #blockDuration}; a successful login clears its IP's counter.
 * (L2) a global attempts-per-second ceiling ({@link #globalMaxPerSecond}) is a safety valve against a
 * distributed spray from many IPs that each stay under the per-IP limit.
 *
 * @param enabled master switch; {@code true} by default. When {@code false} the filter is a no-op
 * @param maxAttempts failed logins allowed from one IP within {@link #window} before it is blocked
 * @param window the sliding window over which per-IP failures are counted
 * @param blockDuration how long a tripped IP stays blocked (429 with {@code Retry-After})
 * @param globalMaxPerSecond ceiling on login attempts per second across all IPs (L2 safety valve)
 */
@ConfigurationProperties("reputation-pool.admin.login-throttle")
public record LoginThrottleProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("5") int maxAttempts,
        @DefaultValue("PT15M") Duration window,
        @DefaultValue("PT15M") Duration blockDuration,
        @DefaultValue("20") int globalMaxPerSecond) {}
