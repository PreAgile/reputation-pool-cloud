package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventPage;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventRecord;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Keyset-paginated read of the audit trail for the dashboard (issue #11/#30), newest first. Requires a
 * valid admin token like the rest of {@code /api/**}.
 *
 * <p>{@code GET /api/events?cursor=&limit=} returns the latest {@code limit} events when {@code cursor}
 * is absent, otherwise the page immediately older than {@code cursor}. The response carries a
 * {@code nextCursor} (opaque, URL-safe) to fetch the next older page, or {@code null} on the last page.
 * The cursor is decoded via {@link Cursors}; a malformed cursor is a 400. This replaces the earlier
 * {@code page/size} offset paging (see {@link AuditEventReader} for why keyset).
 *
 * <p>The page is scoped to the server-decided tenant on the validated admin JWT ({@link AdminTenant}),
 * never a request parameter (security.md) — the same rule {@link PoolController} follows. The trail is
 * now fed per tenant via {@code PostgresAuditTrail.forPool(tenantId)} (#29), so the reader filters by
 * {@code pool_id} and one tenant never sees another's events in this durable audit feed. The live gRPC
 * {@code SubscribeEvents} stream is tenant-isolated the same way (#29), scoped by the advisor service's
 * {@code subscriptionPoolId()} override.
 */
@RestController
@RequestMapping("/api/events")
public class EventController {

    private final AuditEventReader reader;

    public EventController(AuditEventReader reader) {
        this.reader = Objects.requireNonNull(reader, "reader must not be null");
    }

    @GetMapping
    public EventsResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        Long beforeSeq = decodeCursor(cursor);
        AuditEventPage page = reader.page(AdminTenant.of(jwt), beforeSeq, limit);
        String nextCursor = page.nextCursor() == null ? null : Cursors.encode(page.nextCursor());
        return new EventsResponse(page.events(), nextCursor);
    }

    /** {@code null}/blank cursor → start at the latest; a malformed cursor → 400. */
    private static Long decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            return Cursors.decode(cursor);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid cursor");
        }
    }

    /** Wire shape: the page's events plus an opaque {@code nextCursor} ({@code null} on the last page). */
    public record EventsResponse(List<AuditEventRecord> events, String nextCursor) {}
}
