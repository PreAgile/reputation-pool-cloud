package io.github.preagile.reputationpool.cloud.policy;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The one branch of {@link JdbcEnginePolicyRepository} that cannot be produced on demand against a real
 * database: the unique violation a losing concurrent writer gets. {@code EnginePolicyRepositoryIT} shows
 * the invariant holds under a real race, but a race cannot be made to happen deterministically, so the
 * translation itself is pinned here with a driver that reports the SQL state directly.
 *
 * <p>It matters because the two failures are answered differently by the control plane: a conflict is a
 * 409 telling the caller to re-read and retry, while any other SQL failure is a 500. Collapsing them
 * would either hide a real outage behind "retry" or tell a caller to give up on a retryable write.
 */
@DisplayName("JdbcEnginePolicyRepository: 동시 쓰기 충돌만 골라 재시도 가능한 예외로 번역하는 정책 저장소")
class JdbcEnginePolicyRepositoryTest {

    private static final String UNIQUE_VIOLATION = "23505";

    private static final EnginePolicy POLICY = new EnginePolicy(10, 2, 2, Duration.ofSeconds(30), 6, 1.0);

    /** A DataSource whose INSERT fails with the given SQL state; the revision SELECT succeeds first. */
    private static DataSource failingInsertWith(String sqlState) throws SQLException {
        Connection connection = mock(Connection.class);
        PreparedStatement select = mock(PreparedStatement.class);
        ResultSet revisionRow = mock(ResultSet.class);
        when(revisionRow.next()).thenReturn(true);
        when(revisionRow.getInt(1)).thenReturn(1);
        when(select.executeQuery()).thenReturn(revisionRow);
        PreparedStatement insert = mock(PreparedStatement.class);
        when(insert.executeUpdate()).thenThrow(new SQLException("insert failed", sqlState));
        when(connection.prepareStatement(anyString())).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            return sql.startsWith("SELECT") ? select : insert;
        });
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        return dataSource;
    }

    @Test
    @DisplayName("INSERT 가 유니크 위반(23505)으로 실패하면 → 재시도하라는 충돌 예외로 번역한다(컨트롤 플레인의 409)")
    void aUniqueViolationBecomesAConflict() throws SQLException {
        JdbcEnginePolicyRepository repository = new JdbcEnginePolicyRepository(failingInsertWith(UNIQUE_VIOLATION));

        assertThatThrownBy(() -> repository.append("acme", POLICY, "admin", Instant.now()))
                .isInstanceOf(EnginePolicyConflictException.class)
                .hasMessageContaining("retry");
    }

    @Test
    @DisplayName("다른 SQL 오류로 실패하면 → 충돌이 아니라 일반 실패로 던진다(장애를 '재시도하세요'로 감추지 않는다)")
    void anyOtherSqlFailureIsNotAConflict() throws SQLException {
        JdbcEnginePolicyRepository repository = new JdbcEnginePolicyRepository(failingInsertWith("08006"));

        assertThatThrownBy(() -> repository.append("acme", POLICY, "admin", Instant.now()))
                .isInstanceOf(IllegalStateException.class)
                .isNotInstanceOf(EnginePolicyConflictException.class);
    }

    @Test
    @DisplayName("history 의 limit 이 1 미만이면 → 쿼리를 보내기 전에 거부한다")
    void rejectsANonPositiveHistoryLimit() {
        JdbcEnginePolicyRepository repository = new JdbcEnginePolicyRepository(mock(DataSource.class));

        assertThatThrownBy(() -> repository.history("acme", 0)).isInstanceOf(IllegalArgumentException.class);
    }
}
