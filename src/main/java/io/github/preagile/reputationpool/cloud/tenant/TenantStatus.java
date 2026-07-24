package io.github.preagile.reputationpool.cloud.tenant;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/**
 * A tenant's lifecycle state — the cloud-owned state machine the control plane drives (issue #83). The
 * public engine has no tenant concept, so this type lives entirely in cloud.
 *
 * <p><b>Transitions.</b> {@code ACTIVE} is the only state that serves traffic; {@code SUSPENDED} is a
 * reversible freeze (the data-plane hook denies its keys, see {@code JdbcTenantResolver}); {@code
 * DELETED} is a terminal tombstone left behind after the tenant's scoped data has been hard-deleted, so
 * the deletion itself stays auditable. The legal edges are:
 *
 * <pre>
 *   ACTIVE    → SUSPENDED, DELETED
 *   SUSPENDED → ACTIVE, DELETED
 *   DELETED   → (none — terminal)
 * </pre>
 *
 * <p><b>Persistence.</b> The {@code tenant.status} column has always stored the lowercase spelling
 * ({@code active} default from V100), so to avoid a data migration the enum maps case-insensitively:
 * read with {@link #fromDb(String)}, write with {@link #toDb()}. Migration V104 pins the column to
 * exactly these three lowercase spellings with a CHECK constraint.
 */
public enum TenantStatus {
    ACTIVE,
    SUSPENDED,
    DELETED;

    /** Whether a transition from this state to {@code next} is legal (see the class-level table). */
    public boolean canTransitionTo(TenantStatus next) {
        return switch (this) {
            case ACTIVE -> next == SUSPENDED || next == DELETED;
            case SUSPENDED -> next == ACTIVE || next == DELETED;
            case DELETED -> false;
        };
    }

    /**
     * The lowercase spelling persisted in {@code tenant.status} and serialized on the wire. {@code
     * @JsonValue} keeps the REST response lowercase ({@code "active"}) — the same shape clients saw when
     * {@code status} was a free string — instead of the enum's default uppercase {@code name()}.
     */
    @JsonValue
    public String toDb() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** Maps a persisted {@code tenant.status} value back to the enum, ignoring case. */
    public static TenantStatus fromDb(String value) {
        return valueOf(value.toUpperCase(Locale.ROOT));
    }
}
