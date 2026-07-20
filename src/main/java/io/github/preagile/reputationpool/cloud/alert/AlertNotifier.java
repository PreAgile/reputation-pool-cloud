package io.github.preagile.reputationpool.cloud.alert;

/**
 * Delivers a state-transition {@link AlertPayload} to its destination (issue #45, slice A). Kept as a
 * port so {@link AlertingEventSink} — which sits on the engine hot path — depends on an interface, not on
 * an HTTP client, and so tests can substitute a stub without opening a socket.
 *
 * <p><b>Contract: never block, never throw.</b> {@link #notify(AlertPayload)} is invoked from inside the
 * engine's event emission, so an implementation must return promptly (hand the actual I/O to another
 * thread) and must not propagate an exception — a failed or slow alert can never be allowed to stall or
 * break the engine. A disabled / unconfigured implementation is a silent no-op.
 */
public interface AlertNotifier {

    /**
     * Delivers the alert, asynchronously and best-effort. Returns immediately; delivery failures are
     * swallowed (logged at most). Must not throw.
     *
     * @param payload the alert to deliver; never null
     */
    void notify(AlertPayload payload);
}
