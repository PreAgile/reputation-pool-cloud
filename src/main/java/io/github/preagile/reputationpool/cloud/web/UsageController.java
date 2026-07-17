package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader;
import io.github.preagile.reputationpool.cloud.readmodel.UsageMeterReader.UsageSummary;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Objects;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The dashboard usage view (issue #10): the bound tenant's granted-lease counts (daily + this month)
 * and current pool size, read from {@code usage_meter}. Requires a valid admin token like the rest of
 * {@code /api/**}; the tenant is the server-decided one on the JWT ({@link AdminTenant}), never a
 * request parameter (security.md).
 */
@RestController
@RequestMapping("/api/usage")
public class UsageController {

    private final UsageMeterReader reader;
    private final Clock clock;

    public UsageController(UsageMeterReader reader, Clock clock) {
        this.reader = Objects.requireNonNull(reader, "reader must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @GetMapping
    public UsageSummary usage(@AuthenticationPrincipal Jwt jwt) {
        return reader.read(AdminTenant.of(jwt), LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC));
    }
}
