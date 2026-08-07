package io.github.preagile.reputationpool.cloud.web.dto;

/**
 * The body of a per-tenant engine policy write (issue #179). Every field is boxed and
 * {@code leaseTtl} is an ISO-8601 string, both deliberately.
 *
 * <p><b>Boxed, so "absent" is distinguishable from "zero".</b> A tenant policy is all-or-nothing — it is
 * complete or it does not exist — and with primitives a missing {@code coolAfter} would silently bind to
 * {@code 0} and be rejected as out of range, blaming the caller for a value they never sent. Nullable
 * fields let the controller answer "this field is required" instead.
 *
 * <p><b>{@code leaseTtl} as a string</b> so the wire format is pinned to ISO-8601 ({@code "PT30S"}) by
 * this type rather than by whichever Jackson duration settings happen to be in effect, and so a
 * malformed value is a 400 naming the field instead of a generic unreadable-body error.
 */
public record SetEnginePolicyRequest(
        Integer windowSize,
        Integer coolAfter,
        Integer recoverAfter,
        String leaseTtl,
        Integer cooldownMaxExponent,
        Double explorationFloor) {}
