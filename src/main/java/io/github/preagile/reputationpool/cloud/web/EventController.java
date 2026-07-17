package io.github.preagile.reputationpool.cloud.web;

import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader;
import io.github.preagile.reputationpool.cloud.readmodel.AuditEventReader.AuditEventPage;
import java.util.Objects;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Paginated read of the audit trail for the dashboard (issue #11), newest first. Requires a valid
 * admin token like the rest of {@code /api/**}.
 *
 * <p><b>Caveat:</b> {@code audit_event} has no tenant column yet (the trail is fed by the single
 * shared pool via one broadcaster), so events are currently global rather than tenant-scoped — the
 * same interim limitation as the pool read model. Per-tenant event isolation is follow-up work; the
 * endpoint does not filter by a tenant it cannot yet distinguish.
 */
@RestController
@RequestMapping("/api/events")
public class EventController {

    private final AuditEventReader reader;

    public EventController(AuditEventReader reader) {
        this.reader = Objects.requireNonNull(reader, "reader must not be null");
    }

    @GetMapping
    public AuditEventPage list(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size) {
        return reader.page(page, size);
    }
}
