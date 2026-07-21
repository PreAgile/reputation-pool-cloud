package io.github.preagile.reputationpool.cloud.ops;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;

/**
 * The backup's restore rehearsal (#15). A backup nobody has restored is not a backup — so this exercises
 * the exact {@code pg_dump -Fc} / {@code pg_restore} path {@code scripts/backup.sh} and
 * {@code scripts/restore.sh} use, end to end against a real PostgreSQL: seed a source DB, dump it, restore
 * the dump into a <em>separate empty</em> DB, and prove the rows survived. If pg_dump/pg_restore or the
 * format ever stops round-tripping, this fails — which is the whole point of a rehearsal.
 *
 * <p>Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@Testcontainers
@DisplayName("RestoreRehearsalIT: pg_dump 백업을 빈 DB 로 복원해 데이터가 살아남는지 검증하는 복원 리허설")
class RestoreRehearsalIT {

    @Container
    private static final PostgreSQLContainer<?> SOURCE = new PostgreSQLContainer<>("postgres:17");

    @Container
    private static final PostgreSQLContainer<?> TARGET = new PostgreSQLContainer<>("postgres:17");

    @Test
    @DisplayName("소스를 pg_dump(-Fc) 로 뜬 뒤 → 빈 대상 DB 에 pg_restore 하면 → 행이 그대로 복원된다")
    void dumpAndRestoreRoundTripsRows() throws Exception {
        // given: 소스 DB 에 대표 데이터를 심는다.
        try (Connection c =
                        DriverManager.getConnection(SOURCE.getJdbcUrl(), SOURCE.getUsername(), SOURCE.getPassword());
                Statement s = c.createStatement()) {
            s.execute("CREATE TABLE rehearsal (id int PRIMARY KEY, note text NOT NULL)");
            s.execute("INSERT INTO rehearsal VALUES (1, 'alpha'), (2, 'bravo'), (3, 'charlie')");
        }

        // when: backup.sh 와 동일한 custom-format 덤프를 컨테이너 안에서 만든다(로컬 소켓 = trust, 무암호).
        org.testcontainers.containers.Container.ExecResult dump = SOURCE.execInContainer(
                "pg_dump",
                "-U",
                SOURCE.getUsername(),
                "-d",
                SOURCE.getDatabaseName(),
                "-Fc",
                "-f",
                "/tmp/rehearsal.dump");
        assertThat(dump.getExitCode()).as("pg_dump 성공: %s", dump.getStderr()).isZero();

        // 덤프를 소스 → 호스트 → 대상 컨테이너로 옮긴다(-Fc 는 바이너리라 파일로 복사).
        Path onHost = Files.createTempFile("rehearsal", ".dump");
        SOURCE.copyFileFromContainer("/tmp/rehearsal.dump", onHost.toString());
        TARGET.copyFileToContainer(MountableFile.forHostPath(onHost), "/tmp/rehearsal.dump");

        // restore.sh 와 동일하게 대상(빈) DB 로 복원한다.
        org.testcontainers.containers.Container.ExecResult restore = TARGET.execInContainer(
                "pg_restore",
                "-U",
                TARGET.getUsername(),
                "-d",
                TARGET.getDatabaseName(),
                "--clean",
                "--if-exists",
                "--no-owner",
                "/tmp/rehearsal.dump");
        assertThat(restore.getExitCode())
                .as("pg_restore 성공: %s", restore.getStderr())
                .isZero();

        // then: 대상 DB 에 행이 그대로 살아있다.
        try (Connection c =
                        DriverManager.getConnection(TARGET.getJdbcUrl(), TARGET.getUsername(), TARGET.getPassword());
                Statement s = c.createStatement();
                ResultSet rs = s.executeQuery("SELECT id, note FROM rehearsal ORDER BY id")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("id")).isEqualTo(1);
            assertThat(rs.getString("note")).isEqualTo("alpha");
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("id")).isEqualTo(2);
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt("id")).isEqualTo(3);
            assertThat(rs.getString("note")).isEqualTo("charlie");
            assertThat(rs.next()).as("정확히 3행만 복원").isFalse();
        }

        Files.deleteIfExists(onHost);
    }
}
