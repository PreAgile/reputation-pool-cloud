package io.github.preagile.reputationpool.cloud.metering;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * The connection handling of {@link OutcomeRollup}'s two schedules, on the paths a real database cannot be
 * made to take on demand. Both {@code flush()} and {@code purgeExpired()} run on a timer forever, so a
 * connection that is acquired and then dropped without being closed is not a one-off — it is one lease
 * leaked per cycle until the pool is empty and every write in the process starts blocking. Docker-free.
 */
@DisplayName("OutcomeRollup(connection): 커넥션을 얻은 뒤 실패해도 반드시 풀로 돌려주는 롤업")
class OutcomeRollupConnectionTest {

    private static final Instant NOW = Instant.parse("2026-08-12T10:42:31Z");

    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final OutcomeRecorder recorder = new OutcomeRecorder();

    /** Retention on (365일, 기본값) — 퍼지가 실제로 커넥션을 여는 설정이라야 이 테스트가 의미가 있다. */
    private final ReputationPoolProperties properties = new ReputationPoolProperties(
            Duration.ofSeconds(30),
            Duration.ofSeconds(30),
            null,
            null,
            null,
            null,
            new ReputationPoolProperties.Outcome(Duration.ofMinutes(1), Duration.ofDays(365), Duration.ofHours(1)),
            null,
            null);

    /** A pool whose connections refuse to have their commit mode set — the failure right after acquire. */
    private static DataSource poolRefusingAutoCommit(Connection connection) throws SQLException {
        Mockito.doThrow(new SQLException("connection is closed"))
                .when(connection)
                .setAutoCommit(true);
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        return dataSource;
    }

    @Test
    @DisplayName("커넥션을 얻은 직후 setAutoCommit 이 실패하면 → 그 커넥션을 닫아 풀로 돌려주고 카운트는 되돌린다")
    void aConnectionThatFailsToConfigureIsStillReturnedToThePool() throws Exception {
        Connection connection = mock(Connection.class);
        recorder.recordSuccess("tenant-a", "scrape", ResourceKind.PROXY, NOW.truncatedTo(ChronoUnit.HOURS));
        OutcomeRollup rollup = new OutcomeRollup(poolRefusingAutoCommit(connection), clock, recorder, properties);

        rollup.flush();

        verify(connection).close();
        // 실패한 플러시는 카운트를 버리지 않는다 — 다음 주기에 그대로 다시 나온다.
        assertThat(recorder.drain(NOW.truncatedTo(ChronoUnit.HOURS)))
                .as("플러시가 DB 에 닿지 못했으므로 버킷이 되돌려져 있다")
                .hasSize(1);
    }

    @Test
    @DisplayName("퍼지도 같은 실패에서 → 커넥션을 닫고 스케줄을 멈추지 않는다")
    void thePurgeAlsoReturnsAConnectionItCouldNotConfigure() throws Exception {
        Connection connection = mock(Connection.class);
        OutcomeRollup rollup = new OutcomeRollup(poolRefusingAutoCommit(connection), clock, recorder, properties);

        rollup.purgeExpired(); // 예외를 밖으로 던지지 않는다 — 던지면 @Scheduled 가 취소된다

        verify(connection, times(1)).close();
    }
}
