package io.github.preagile.reputationpool.cloud.alert;

import io.github.preagile.reputationpool.core.domain.PoolEvent;
import java.time.Instant;
import java.util.Objects;

/**
 * The JSON body of a state-transition alert (issue #45, slice A). Deliberately a small, operator-facing
 * fact — <em>what</em> transitioned, <em>which</em> resource, and <em>when</em> — and nothing more. It is
 * serialized straight to the webhook body by {@link WebhookAlertNotifier}.
 *
 * <p><b>No secrets.</b> The payload carries only the resource's {@code kind} and its already-public
 * identifier {@code value} (the same fields the audit trail and dashboard already expose); it never
 * includes API keys, JWTs, the webhook URL, or any credential (security.md). {@code resourceValue} is the
 * resource identifier the engine itself keys on — the operator needs it to act — not a secret.
 *
 * <p>Tenant is intentionally absent: this sink is the process-wide fan-out sink shared across every
 * tenant's pool (see {@code EngineConfiguration#poolEventSink}), and {@link PoolEvent} carries no tenant
 * field, so a truthful tenant cannot be attributed here. Per-tenant attribution is a deferred follow-up.
 *
 * @param eventType the transition, e.g. {@code RESOURCE_BLOCKLISTED}
 * @param resourceKind the resource kind (PROXY / ACCOUNT / SESSION)
 * @param resourceValue the resource identifier (public id the engine keys on; not a secret)
 * @param at when the transition occurred (UTC instant)
 * @param until when the block lifts; {@code null} when permanent (see {@link #permanent})
 * @param permanent whether the block never lifts on its own ({@code until == Instant.MAX})
 */
public record AlertPayload(
        String eventType, String resourceKind, String resourceValue, Instant at, Instant until, boolean permanent) {

    /** The single transition this slice alerts on (issue #45: BLOCKLISTED only; COOLING surge is deferred). */
    public static final String RESOURCE_BLOCKLISTED = "RESOURCE_BLOCKLISTED";

    public AlertPayload {
        Objects.requireNonNull(eventType, "eventType must not be null");
        Objects.requireNonNull(resourceKind, "resourceKind must not be null");
        Objects.requireNonNull(resourceValue, "resourceValue must not be null");
        Objects.requireNonNull(at, "at must not be null");
    }

    /**
     * Builds the alert body from a {@code ResourceBlocklisted} fact. A permanent block is emitted as
     * {@code permanent=true} with a {@code null} {@code until}, so consumers do not have to reason about
     * the {@link Instant#MAX} sentinel.
     */
    public static AlertPayload ofBlocklisted(PoolEvent.ResourceBlocklisted event) {
        boolean permanent = Instant.MAX.equals(event.until());
        return new AlertPayload(
                RESOURCE_BLOCKLISTED,
                event.resource().kind().name(),
                event.resource().value(),
                event.at(),
                permanent ? null : event.until(),
                permanent);
    }
}
