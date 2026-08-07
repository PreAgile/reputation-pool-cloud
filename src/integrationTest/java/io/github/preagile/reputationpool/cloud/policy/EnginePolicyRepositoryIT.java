package io.github.preagile.reputationpool.cloud.policy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.preagile.reputationpool.cloud.tenant.Tenant;
import io.github.preagile.reputationpool.cloud.tenant.TenantRepository;
import io.github.preagile.reputationpool.cloud.tenant.TenantStatus;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Integration test (Testcontainers PostgreSQL) for {@link EnginePolicyRepository} against the real
 * {@code tenant_engine_policy} table (migration V105). Three things can only be checked here: that the
 * append-only revision scheme actually reads back the latest row, that the {@code CHECK} constraints
 * really are the last line of defence when the application's own validation is bypassed, and that a
 * lookup for a tenant with no policy comes back empty rather than failing — the state every tenant is in
 * the moment this ships.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@DisplayName("EnginePolicyRepositoryIT: 실제 PostgreSQL 의 tenant_engine_policy 에서 append-only 정책 저장·조회가 동작하는지 검증하는 통합테스트")
@SpringBootTest(properties = {"reputation-pool.auth.api-key=it-key", "grpc.server.port=0"})
@Import(EnginePolicyRepositoryIT.Containers.class)
class EnginePolicyRepositoryIT {

    private static final Instant AT = Instant.parse("2026-08-07T09:00:00Z");

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private EnginePolicyRepository repository;

    @Autowired
    private TenantRepository tenants;

    @Autowired
    private DataSource dataSource;

    private static EnginePolicy policy(int windowSize, int coolAfter) {
        return new EnginePolicy(windowSize, coolAfter, 2, Duration.ofSeconds(45), 6, 1.5);
    }

    private String newTenant(String id) {
        tenants.create(new Tenant(id, id, TenantStatus.ACTIVE, AT));
        return id;
    }

    @Test
    @DisplayName("정책을 저장한 적 없는 테넌트를 조회하면 → 비어 있다(전역 기본값으로 도는 정상 상태다)")
    void aTenantWithoutAPolicyReadsEmpty() {
        String tenant = newTenant("policy-none");

        assertThat(repository.findCurrent(tenant)).isEmpty();
        assertThat(repository.history(tenant, 10)).isEmpty();
    }

    @Test
    @DisplayName("정책을 저장하면 → revision 1 로 남고 모든 필드가 그대로 되읽힌다")
    void appendsTheFirstRevisionAndReadsEveryFieldBack() {
        String tenant = newTenant("policy-first");

        EnginePolicyRevision saved = repository.append(tenant, policy(20, 3), "admin", AT);

        assertThat(saved.revision()).isEqualTo(1);
        assertThat(repository.findCurrent(tenant))
                .contains(new EnginePolicyRevision(tenant, 1, policy(20, 3), "admin", AT));
    }

    @Test
    @DisplayName("같은 테넌트에 세 번 저장하면 → revision 이 1·2·3 으로 늘고 조회는 항상 최신(3)을 준다")
    void successiveWritesIncrementTheRevisionAndTheLatestWins() {
        String tenant = newTenant("policy-many");

        assertThat(repository.append(tenant, policy(10, 2), "admin", AT).revision())
                .isEqualTo(1);
        assertThat(repository.append(tenant, policy(20, 3), "admin", AT).revision())
                .isEqualTo(2);
        assertThat(repository.append(tenant, policy(30, 4), "operator", AT).revision())
                .isEqualTo(3);

        assertThat(repository.findCurrent(tenant)).get().satisfies(current -> {
            assertThat(current.revision()).isEqualTo(3);
            assertThat(current.policy()).isEqualTo(policy(30, 4));
            assertThat(current.changedBy()).isEqualTo("operator");
        });
    }

    @Test
    @DisplayName("이력을 조회하면 → 최신부터 역순으로, 덮어써진 옛 값까지 그대로 남아 있다(무엇을→무엇으로 바뀌었는지가 읽힌다)")
    void historyKeepsEverySupersededRevision() {
        String tenant = newTenant("policy-history");
        repository.append(tenant, policy(10, 2), "admin", AT);
        repository.append(tenant, policy(20, 3), "operator", AT);

        assertThat(repository.history(tenant, 10))
                .extracting(
                        EnginePolicyRevision::revision, r -> r.policy().coolAfter(), EnginePolicyRevision::changedBy)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(2, 3, "operator"),
                        org.assertj.core.groups.Tuple.tuple(1, 2, "admin"));
    }

    @Test
    @DisplayName("두 테넌트가 각자 정책을 저장하면 → 서로의 리비전과 값이 섞이지 않는다")
    void revisionsAreScopedPerTenant() {
        String a = newTenant("policy-iso-a");
        String b = newTenant("policy-iso-b");
        repository.append(a, policy(10, 2), "admin", AT);
        repository.append(a, policy(20, 3), "admin", AT);
        repository.append(b, policy(30, 4), "admin", AT);

        // b's first write is revision 1, not 3: the counter is per tenant.
        assertThat(repository.findCurrent(b))
                .get()
                .extracting(EnginePolicyRevision::revision)
                .isEqualTo(1);
        assertThat(repository.findCurrent(a))
                .get()
                .extracting(EnginePolicyRevision::revision)
                .isEqualTo(2);
        assertThat(repository.findCurrent(b))
                .get()
                .extracting(EnginePolicyRevision::policy)
                .isEqualTo(policy(30, 4));
    }

    @Test
    @DisplayName("여러 스레드가 같은 테넌트에 동시에 저장하면 → 성공한 만큼만 리비전이 남고 어떤 리비전도 덮어써지지 않는다")
    void concurrentWritesNeverOverwriteEachOther() throws Exception {
        String tenant = newTenant("policy-race");
        int writers = 8;
        // Two-phase rendezvous so every writer is actually inside append at the same time, rather than
        // hoping the scheduler interleaves them.
        CountDownLatch ready = new CountDownLatch(writers);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger succeeded = new AtomicInteger();
        AtomicInteger conflicted = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(writers);
        try {
            for (int i = 0; i < writers; i++) {
                int coolAfter = i + 1;
                pool.submit(() -> {
                    ready.countDown();
                    try {
                        go.await();
                        repository.append(tenant, policy(10, coolAfter), "writer-" + coolAfter, AT);
                        succeeded.incrementAndGet();
                    } catch (EnginePolicyConflictException e) {
                        conflicted.incrementAndGet();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return null;
                });
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            go.countDown();
        } finally {
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        // Every writer either committed a revision or was refused; none silently replaced another's.
        assertThat(succeeded.get() + conflicted.get()).isEqualTo(writers);
        assertThat(succeeded.get()).isPositive();
        // The equality is the point: as many rows as successes, numbered 1..n with no duplicate and no
        // gap. A lost update would show up here as fewer rows than successes.
        List<EnginePolicyRevision> history = repository.history(tenant, writers * 2);
        assertThat(history).hasSize(succeeded.get());
        assertThat(history)
                .extracting(EnginePolicyRevision::revision)
                .containsExactlyElementsOf(IntStream.rangeClosed(1, succeeded.get())
                        .boxed()
                        .sorted(Comparator.reverseOrder())
                        .toList());
    }

    @Test
    @DisplayName("애플리케이션 검증을 우회해 cool-after=0 을 직접 넣으면 → DB CHECK 가 막는다(마지막 방어선)")
    void theDatabaseRefusesAnOutOfRangePolicyEvenWhenTheApplicationIsBypassed() {
        String tenant = newTenant("policy-check");

        assertThatThrownBy(() -> insertRawPolicy(tenant, 1, 10, 0, 30_000L, 6, 1.0))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("cool_after");
    }

    @Test
    @DisplayName("쿨다운 지수를 upstream 한계 위로 직접 넣으면 → DB CHECK 가 막는다")
    void theDatabaseRefusesACooldownExponentAboveTheUpstreamLimit() {
        String tenant = newTenant("policy-check-exp");

        assertThatThrownBy(() -> insertRawPolicy(tenant, 1, 10, 2, 30_000L, 22, 1.0))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("cooldown_max_exponent");
    }

    @Test
    @DisplayName("exploration-floor 에 NaN 을 직접 넣으면 → DB CHECK 가 막는다(> 0 만으로는 NaN 이 통과한다)")
    void theDatabaseRefusesNaNAsAnExplorationFloor() {
        String tenant = newTenant("policy-check-nan");

        assertThatThrownBy(() -> insertRawPolicy(tenant, 1, 10, 2, 30_000L, 6, Double.NaN))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("exploration_floor");
    }

    @Test
    @DisplayName("존재하지 않는 테넌트의 정책을 직접 넣으려 하면 → 외래키가 막는다")
    void theDatabaseRefusesAPolicyForAnUnknownTenant() {
        assertThatThrownBy(() -> insertRawPolicy("no-such-tenant", 1, 10, 2, 30_000L, 6, 1.0))
                .isInstanceOf(SQLException.class);
    }

    /** Writes a row bypassing {@link EnginePolicy}'s validation, so only the schema is under test. */
    private void insertRawPolicy(
            String tenantId,
            int revision,
            int windowSize,
            int coolAfter,
            long leaseTtlMillis,
            int cooldownMaxExponent,
            double explorationFloor)
            throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO tenant_engine_policy (tenant_id, revision, window_size, cool_after,"
                                + " recover_after, lease_ttl_millis, cooldown_max_exponent, exploration_floor,"
                                + " changed_by, changed_at) VALUES (?, ?, ?, ?, 2, ?, ?, ?, 'admin', ?)")) {
            statement.setString(1, tenantId);
            statement.setInt(2, revision);
            statement.setInt(3, windowSize);
            statement.setInt(4, coolAfter);
            statement.setLong(5, leaseTtlMillis);
            statement.setInt(6, cooldownMaxExponent);
            statement.setDouble(7, explorationFloor);
            statement.setTimestamp(8, java.sql.Timestamp.from(AT));
            statement.executeUpdate();
        }
    }
}
