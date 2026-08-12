package io.github.preagile.reputationpool.cloud.policy;

/**
 * Two policy writes for the same tenant raced and both computed the same next revision; the one that
 * lost the unique constraint throws this. The caller should re-read the current policy and retry, which
 * is why the control plane answers it with {@code 409 Conflict} — the same posture
 * {@code TenantLifecycleService} takes when a lifecycle compare-and-set loses its race.
 */
public class EnginePolicyConflictException extends RuntimeException {

    public EnginePolicyConflictException(String message, Throwable cause) {
        super(message, cause);
    }
}
