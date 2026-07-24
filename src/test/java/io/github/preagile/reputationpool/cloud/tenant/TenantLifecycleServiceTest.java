package io.github.preagile.reputationpool.cloud.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.engine.GlobalResourceBudget;
import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import io.github.preagile.reputationpool.core.domain.Blocklist;
import io.github.preagile.reputationpool.core.domain.CellKey;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.PoolSnapshot;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.github.preagile.reputationpool.core.pool.ResourcePool;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * {@link TenantLifecycleService} 단위 테스트. 저장소·풀 레지스트리·전역 예산을 목으로 두고, 상태기 규칙 강제
 * (불법 전이 409·없는 테넌트 404), 동시 전이 경쟁(CAS 실패 시 재조회 후 멱등/409), 삭제 오케스트레이션 순서
 * (스냅샷 캡처→축출→DB 삭제→예산 반납)를 검증한다. DB나 gRPC 없이 순수 조율 로직만 본다.
 */
@DisplayName("TenantLifecycleService: 테넌트를 정지·재활성·삭제하며 상태기 규칙·경쟁 조건·삭제 순서·예산 반납을 강제하는 생애 관장자")
class TenantLifecycleServiceTest {

    private final TenantRepository tenants = mock(TenantRepository.class);
    private final TenantPoolRegistry registry = mock(TenantPoolRegistry.class);
    private final GlobalResourceBudget budget = mock(GlobalResourceBudget.class);
    private final TenantLifecycleService service = new TenantLifecycleService(tenants, registry, budget);

    private void tenantIs(String id, TenantStatus status) {
        when(tenants.findById(id)).thenReturn(Optional.of(new Tenant(id, id, status, Instant.EPOCH)));
    }

    /** Sequential reads: first the pre-write check, then the post-CAS-failure re-check. */
    private void tenantIsThen(String id, TenantStatus first, TenantStatus second) {
        when(tenants.findById(id))
                .thenReturn(
                        Optional.of(new Tenant(id, id, first, Instant.EPOCH)),
                        Optional.of(new Tenant(id, id, second, Instant.EPOCH)));
    }

    private static int statusOf(Throwable e) {
        return ((ResponseStatusException) e).getStatusCode().value();
    }

    private static ResourceId proxy(String value) {
        return new ResourceId(ResourceKind.PROXY, value);
    }

    /** A pool snapshot with the given number of registered resources and cells, for budget-release tests. */
    private static PoolSnapshot snapshotOf(int resources, int cells) {
        Set<ResourceId> registered = new java.util.HashSet<>();
        for (int i = 0; i < resources; i++) {
            registered.add(proxy("r" + i));
        }
        Map<CellKey, ReputationCell> cellMap = new java.util.HashMap<>();
        for (int i = 0; i < cells; i++) {
            ResourceId resource = proxy("c" + i);
            Context context = new Context("ctx");
            cellMap.put(new CellKey(resource, context), ReputationCell.fresh(resource, context, Instant.EPOCH));
        }
        return new PoolSnapshot(cellMap, Blocklist.empty(), registered);
    }

    @Nested
    @DisplayName("suspend / reactivate")
    class SuspendReactivate {

        @Test
        @DisplayName("active 테넌트를 정지하면 → CAS 로 상태를 SUSPENDED 로 갱신한다")
        void suspendingActive_updatesToSuspended() {
            tenantIs("acme", TenantStatus.ACTIVE);
            when(tenants.compareAndSetStatus("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED))
                    .thenReturn(true);

            service.suspend("acme");

            verify(tenants).compareAndSetStatus("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED);
        }

        @Test
        @DisplayName("이미 정지된 테넌트를 다시 정지하면 → CAS 를 호출하지 않고 그대로 통과한다(멱등)")
        void suspendingAlreadySuspended_isNoOp() {
            tenantIs("acme", TenantStatus.SUSPENDED);

            service.suspend("acme");

            verify(tenants, never()).compareAndSetStatus(any(), any(), any());
        }

        @Test
        @DisplayName("정지된 테넌트를 재활성화하면 → CAS 로 상태를 ACTIVE 로 갱신한다")
        void reactivatingSuspended_updatesToActive() {
            tenantIs("acme", TenantStatus.SUSPENDED);
            when(tenants.compareAndSetStatus("acme", TenantStatus.SUSPENDED, TenantStatus.ACTIVE))
                    .thenReturn(true);

            service.reactivate("acme");

            verify(tenants).compareAndSetStatus("acme", TenantStatus.SUSPENDED, TenantStatus.ACTIVE);
        }
    }

    @Nested
    @DisplayName("동시 전이 경쟁 (CAS 실패)")
    class ConcurrentTransition {

        @Test
        @DisplayName("suspend 도중 다른 요청이 먼저 그 테넌트를 삭제해버리면 → CAS 가 지고, 재조회 결과가 DELETED 라서 409 로 거절한다")
        void suspendLosesRaceToDelete_is409AndDoesNotOverwriteTombstone() {
            tenantIsThen("acme", TenantStatus.ACTIVE, TenantStatus.DELETED);
            when(tenants.compareAndSetStatus("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED))
                    .thenReturn(false); // lost the race — a concurrent delete already tombstoned it

            assertThatThrownBy(() -> service.suspend("acme"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.CONFLICT.value()));

            // Exactly the one CAS attempt — no blind overwrite, no retry loop.
            verify(tenants).compareAndSetStatus("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED);
        }

        @Test
        @DisplayName("suspend 가 CAS 에서 졌지만 재조회 결과가 이미 목표 상태(SUSPENDED)면 → 예외 없이 통과한다(멱등)")
        void suspendLosesRaceButTargetAlreadyReached_isIdempotent() {
            tenantIsThen("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED);
            when(tenants.compareAndSetStatus("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED))
                    .thenReturn(false); // another suspend call already won

            assertThatCode(() -> service.suspend("acme")).doesNotThrowAnyException();
        }
    }

    @Nested
    @DisplayName("불법 전이 · 없는 테넌트")
    class IllegalAndMissing {

        @Test
        @DisplayName("삭제된 테넌트를 정지하려 하면 → 409 로 거절하고 CAS 를 시도하지 않는다")
        void suspendingDeleted_is409() {
            tenantIs("gone", TenantStatus.DELETED);

            assertThatThrownBy(() -> service.suspend("gone"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.CONFLICT.value()));
            verify(tenants, never()).compareAndSetStatus(any(), any(), any());
        }

        @Test
        @DisplayName("없는 테넌트를 정지하려 하면 → 404 로 거절한다")
        void suspendingUnknown_is404() {
            when(tenants.findById("ghost")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.suspend("ghost"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.NOT_FOUND.value()));
        }
    }

    @Nested
    @DisplayName("delete")
    class Delete {

        private ResourcePool poolReturning(PoolSnapshot snapshot) {
            ResourcePool pool = mock(ResourcePool.class);
            when(pool.snapshot()).thenReturn(snapshot);
            return pool;
        }

        @Test
        @DisplayName("active 테넌트를 삭제하면 → 스냅샷 캡처 → 인메모리 풀 축출 → DB 삭제 순서로 실행한다")
        void deletingActive_capturesSnapshotThenEvictsThenPurges() {
            tenantIs("acme", TenantStatus.ACTIVE);
            ResourcePool acmePool = poolReturning(snapshotOf(0, 0));

            when(registry.poolFor("acme")).thenReturn(acmePool);
            when(tenants.deleteTenantData("acme", TenantStatus.ACTIVE)).thenReturn(true);

            service.delete("acme");

            InOrder order = inOrder(registry, tenants);
            order.verify(registry).poolFor("acme"); // 스냅샷 캡처가 축출보다 먼저 (축출 후엔 새 빈 풀이 생김)
            order.verify(registry).evict("acme");
            order.verify(tenants).deleteTenantData("acme", TenantStatus.ACTIVE);
        }

        @Test
        @DisplayName("삭제 직전 풀에 리소스 3개·셀 5개가 있었으면 → 삭제 후 전역 예산에 정확히 그만큼 반납한다")
        void deletingActive_releasesExactUsageBackToTheBudget() {
            tenantIs("acme", TenantStatus.ACTIVE);
            ResourcePool acmePool = poolReturning(snapshotOf(3, 5));

            when(registry.poolFor("acme")).thenReturn(acmePool);
            when(tenants.deleteTenantData("acme", TenantStatus.ACTIVE)).thenReturn(true);

            service.delete("acme");

            verify(budget).release(3, 5);
        }

        @Test
        @DisplayName("이미 삭제된 테넌트를 다시 삭제하면 → 축출도 삭제도 예산 반납도 하지 않는다(멱등)")
        void deletingAlreadyDeleted_isNoOp() {
            tenantIs("acme", TenantStatus.DELETED);

            service.delete("acme");

            verifyNoInteractions(registry);
            verify(tenants, never()).deleteTenantData(any(), any());
            verifyNoInteractions(budget);
        }

        @Test
        @DisplayName("없는 테넌트를 삭제하려 하면 → 404 로 거절하고 아무것도 건드리지 않는다")
        void deletingUnknown_is404() {
            when(tenants.findById("ghost")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.delete("ghost"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.NOT_FOUND.value()));

            verifyNoInteractions(registry);
            verify(tenants, never()).deleteTenantData(any(), any());
            verifyNoInteractions(budget);
        }

        @Test
        @DisplayName("delete 가 DB 단계에서 경쟁에 지고 재조회 결과가 이미 DELETED 면 → 예외 없이 통과하고 예산은 반납하지 않는다(중복 방지)")
        void deleteLosesRaceButAlreadyDeleted_isIdempotentAndDoesNotDoubleRelease() {
            tenantIsThen("acme", TenantStatus.ACTIVE, TenantStatus.DELETED);
            ResourcePool acmePool = poolReturning(snapshotOf(2, 2));

            when(registry.poolFor("acme")).thenReturn(acmePool);
            when(tenants.deleteTenantData("acme", TenantStatus.ACTIVE)).thenReturn(false);

            assertThatCode(() -> service.delete("acme")).doesNotThrowAnyException();

            verifyNoInteractions(budget); // the racing delete already released it — we must not double-release
        }

        @Test
        @DisplayName("delete 가 DB 단계에서 경쟁에 지고 재조회 결과가 DELETED 가 아니면(예: 동시 정지가 이김) → 409 로 거절한다")
        void deleteLosesRaceToASuspend_is409() {
            tenantIsThen("acme", TenantStatus.ACTIVE, TenantStatus.SUSPENDED);
            ResourcePool acmePool = poolReturning(snapshotOf(0, 0));

            when(registry.poolFor("acme")).thenReturn(acmePool);
            when(tenants.deleteTenantData("acme", TenantStatus.ACTIVE)).thenReturn(false);

            assertThatThrownBy(() -> service.delete("acme"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.CONFLICT.value()));

            verifyNoInteractions(budget);
        }
    }
}
