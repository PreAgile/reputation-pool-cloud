package io.github.preagile.reputationpool.cloud.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.engine.TenantPoolRegistry;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * {@link TenantLifecycleService} 단위 테스트. 저장소·풀 레지스트리를 목으로 두고, 상태기 규칙 강제(불법 전이
 * 409·없는 테넌트 404)와 삭제 오케스트레이션 순서(인메모리 축출 먼저 → DB 캐스케이드)를 검증한다. DB나 gRPC
 * 없이 순수 조율 로직만 본다.
 */
@DisplayName("TenantLifecycleService: 테넌트를 정지·재활성·삭제하며 상태기 규칙과 삭제 순서를 강제하는 생애 관장자")
class TenantLifecycleServiceTest {

    private final TenantRepository tenants = mock(TenantRepository.class);
    private final TenantPoolRegistry registry = mock(TenantPoolRegistry.class);
    private final TenantLifecycleService service = new TenantLifecycleService(tenants, registry);

    private void tenantIs(String id, TenantStatus status) {
        when(tenants.findById(id)).thenReturn(Optional.of(new Tenant(id, id, status, Instant.EPOCH)));
    }

    private static int statusOf(Throwable e) {
        return ((ResponseStatusException) e).getStatusCode().value();
    }

    @Nested
    @DisplayName("suspend / reactivate")
    class SuspendReactivate {

        @Test
        @DisplayName("active 테넌트를 정지하면 → 상태를 SUSPENDED 로 갱신한다")
        void suspendingActive_updatesToSuspended() {
            tenantIs("acme", TenantStatus.ACTIVE);
            service.suspend("acme");
            verify(tenants).updateStatus("acme", TenantStatus.SUSPENDED);
        }

        @Test
        @DisplayName("이미 정지된 테넌트를 다시 정지하면 → 아무 상태 변경도 하지 않는다(멱등)")
        void suspendingAlreadySuspended_isNoOp() {
            tenantIs("acme", TenantStatus.SUSPENDED);
            service.suspend("acme");
            verify(tenants, never())
                    .updateStatus(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        }

        @Test
        @DisplayName("정지된 테넌트를 재활성화하면 → 상태를 ACTIVE 로 갱신한다")
        void reactivatingSuspended_updatesToActive() {
            tenantIs("acme", TenantStatus.SUSPENDED);
            service.reactivate("acme");
            verify(tenants).updateStatus("acme", TenantStatus.ACTIVE);
        }
    }

    @Nested
    @DisplayName("불법 전이 · 없는 테넌트")
    class IllegalAndMissing {

        @Test
        @DisplayName("삭제된 테넌트를 정지하려 하면 → 409 로 거절하고 상태를 바꾸지 않는다")
        void suspendingDeleted_is409() {
            tenantIs("gone", TenantStatus.DELETED);
            assertThatThrownBy(() -> service.suspend("gone"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.CONFLICT.value()));
            verify(tenants, never())
                    .updateStatus(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
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

        @Test
        @DisplayName("active 테넌트를 삭제하면 → 인메모리 풀을 먼저 축출한 뒤 DB 스코프 데이터를 지운다(순서 보장)")
        void deletingActive_evictsBeforePurging() {
            tenantIs("acme", TenantStatus.ACTIVE);

            service.delete("acme");

            InOrder order = inOrder(registry, tenants);
            order.verify(registry).evict("acme"); // 메모리 먼저 — traffic 차단
            order.verify(tenants).deleteTenantData("acme"); // 그다음 DB 캐스케이드 + 툼스톤
        }

        @Test
        @DisplayName("이미 삭제된 테넌트를 다시 삭제하면 → 축출도 삭제도 하지 않는다(멱등)")
        void deletingAlreadyDeleted_isNoOp() {
            tenantIs("acme", TenantStatus.DELETED);

            service.delete("acme");

            verify(registry, never()).evict(org.mockito.ArgumentMatchers.any());
            verify(tenants, never()).deleteTenantData(org.mockito.ArgumentMatchers.any());
        }

        @Test
        @DisplayName("없는 테넌트를 삭제하려 하면 → 404 로 거절하고 아무것도 건드리지 않는다")
        void deletingUnknown_is404() {
            when(tenants.findById("ghost")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.delete("ghost"))
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> assertThat(statusOf(e)).isEqualTo(HttpStatus.NOT_FOUND.value()));

            verifyNoInteractions(registry);
            verify(tenants, never()).deleteTenantData(org.mockito.ArgumentMatchers.any());
        }
    }
}
