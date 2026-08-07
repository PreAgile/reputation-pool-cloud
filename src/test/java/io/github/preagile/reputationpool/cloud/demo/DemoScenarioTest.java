package io.github.preagile.reputationpool.cloud.demo;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.config.ReputationPoolProperties;
import io.github.preagile.reputationpool.cloud.demo.DemoScenario.Dataset;
import io.github.preagile.reputationpool.cloud.demo.DemoScenario.ScoreSample;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.ReputationCell;
import io.github.preagile.reputationpool.core.domain.ResourceState;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The demo dataset is only worth seeding if it fills the console. These cases pin what "fills" means,
 * screen by screen, against the data the engine actually produced — so a retune of the scripted workload
 * that quietly leaves a screen empty fails here instead of in front of an audience.
 */
@DisplayName("DemoScenario: 실제 엔진을 과거~현재로 재생해 콘솔 모든 화면을 채우는 데모 데이터셋 생성기")
class DemoScenarioTest {

    private static final Instant NOW = Instant.parse("2026-08-07T14:23:00Z");

    private static final DemoDataProperties DEMO =
            new DemoDataProperties(true, "demo", 36, Duration.ofHours(48), 96, 30, 20260807L);

    private static final ReputationPoolProperties ENGINE = new ReputationPoolProperties(
            Duration.ofSeconds(30),
            Duration.ofSeconds(30),
            new ReputationPoolProperties.Engine(10, 2, 2),
            new ReputationPoolProperties.Audit(Duration.ofHours(1), Duration.ZERO),
            new ReputationPoolProperties.Metering(Duration.ofMinutes(1)),
            new ReputationPoolProperties.Score(Duration.ofMinutes(1), Duration.ofDays(7), Duration.ofHours(1)),
            new ReputationPoolProperties.Limits(100_000, 500_000),
            new ReputationPoolProperties.SurgeThresholds(10, 1));

    private static Dataset dataset() {
        return DemoScenario.build(DEMO, ENGINE, NOW);
    }

    @Test
    @DisplayName("설정한 리소스 수만큼 등록되고 리소스마다 여러 컨텍스트를 가지면 → 개요의 리소스 × 컨텍스트 격자가 채워진다")
    void fillsTheResourceByContextGrid() {
        Dataset dataset = dataset();

        assertThat(dataset.snapshot().registered()).hasSize(DEMO.resources());
        assertThat(dataset.snapshot().cells()).hasSizeGreaterThan(DEMO.resources());
        Set<String> contexts = dataset.snapshot().cells().keySet().stream()
                .map(key -> key.context().value())
                .collect(Collectors.toSet());
        assertThat(contexts).as("컨텍스트가 여러 플랫폼으로 갈려야 격자가 의미를 갖는다").hasSizeGreaterThanOrEqualTo(3);
        // 리소스마다 컨텍스트 수가 달라야 격자가 정사각형이 아니라 실제 사용처럼 성기고 조밀하다.
        Map<String, Long> contextsPerResource = dataset.snapshot().cells().keySet().stream()
                .collect(Collectors.groupingBy(key -> key.resource().value(), Collectors.counting()));
        assertThat(contextsPerResource.values().stream().distinct()).hasSizeGreaterThan(1);
    }

    @Test
    @DisplayName("셀 상태가 HEALTHY·COOLING·RECOVERING 에 흩어지고 HEALTHY 가 다수면 → 상태 분포 화면이 한쪽으로 쏠리지 않는다")
    void spreadsCellStates() {
        Map<ResourceState, Long> byState = dataset().snapshot().cells().values().stream()
                .collect(Collectors.groupingBy(ReputationCell::state, Collectors.counting()));

        assertThat(byState).containsKeys(ResourceState.HEALTHY, ResourceState.COOLING, ResourceState.RECOVERING);
        assertThat(byState.get(ResourceState.HEALTHY))
                .as("정상이 다수여야 살아 있는 서비스처럼 보인다")
                .isGreaterThan(byState.get(ResourceState.COOLING) + byState.get(ResourceState.RECOVERING));
    }

    @Test
    @DisplayName("COOLING 인 셀의 쿨다운 종료 시각이 현재보다 미래면 → 지금 냉각 중인 것으로 화면에 남는다")
    void coolingCellsAreStillCoolingAtNow() {
        assertThat(dataset().snapshot().cells().values().stream()
                        .filter(cell -> cell.state() == ResourceState.COOLING)
                        .filter(cell -> cell.cooldownUntil().isAfter(NOW)))
                .as("쿨다운이 이미 지난 COOLING 은 화면에서 '왜 아직 냉각인가'가 설명되지 않는다")
                .isNotEmpty();
    }

    @Test
    @DisplayName("일부 리소스가 차단 목록에 남으면 → 차단 컬럼이 비지 않는다")
    void leavesSomeResourcesBlocked() {
        assertThat(dataset().snapshot().blocklist().entries()).isNotEmpty();
    }

    @Test
    @DisplayName("점수가 높은 값·중간 값·음수까지 퍼지면 → 선택 가중치가 의미 있게 보인다")
    void spreadsScoresIncludingNegatives() {
        var scores = dataset().snapshot().cells().values().stream()
                .map(ReputationCell::score)
                .toList();

        assertThat(scores.stream().filter(score -> score > 50)).as("건강한 축").isNotEmpty();
        assertThat(scores.stream().filter(score -> score > 0 && score <= 50))
                .as("중간 축")
                .isNotEmpty();
        assertThat(scores.stream().filter(score -> score < 0)).as("음수 축").isNotEmpty();
    }

    @Test
    @DisplayName("이벤트가 격리·복귀·차단·해제·거절·대여를 모두 담으면 → 이벤트 목록이 한 종류로만 채워지지 않는다")
    void mixesEveryEventKind() {
        Set<Class<?>> kinds =
                dataset().events().stream().map(PoolEvent::getClass).collect(Collectors.toSet());

        assertThat(kinds)
                .contains(
                        PoolEvent.ResourceCooled.class,
                        PoolEvent.ResourceRecovered.class,
                        PoolEvent.ResourceBlocklisted.class,
                        PoolEvent.ResourceUnblocked.class,
                        PoolEvent.ResourceLeased.class,
                        PoolEvent.LeaseReleased.class,
                        PoolEvent.AcquisitionRejected.class);
    }

    @Test
    @DisplayName("이벤트가 시간순으로 설정한 기간 전체에 퍼지면 → 한 시점에 몰려 찍힌 티가 나지 않는다")
    void spreadsEventsOverTheWholeWindow() {
        var events = dataset().events();
        Instant first = events.get(0).at();
        Instant last = events.get(events.size() - 1).at();

        assertThat(first).isAfterOrEqualTo(NOW.minus(DEMO.history()));
        assertThat(last).isBeforeOrEqualTo(NOW);
        assertThat(Duration.between(first, last))
                .as("기록이 창 전체를 덮어야 한다")
                .isGreaterThan(DEMO.history().minusHours(1));
        assertThat(events.stream().map(PoolEvent::at).toList()).isSorted();
    }

    @Test
    @DisplayName("점수 표본이 셀마다 시간축에 쌓이면 → 24h 곡선이 점 하나가 아니라 선으로 그려진다")
    void stacksScoreSamplesOverTime() {
        Dataset dataset = dataset();
        Map<String, Long> pointsPerSeries = dataset.samples().stream()
                .collect(Collectors.groupingBy(
                        sample -> sample.resource().value() + "|"
                                + sample.context().value(),
                        Collectors.counting()));

        assertThat(pointsPerSeries).isNotEmpty();
        assertThat(pointsPerSeries.values())
                .allSatisfy(points -> assertThat(points).isGreaterThan(10));
        assertThat(dataset.samples().stream().map(ScoreSample::at).max(Instant::compareTo))
                .contains(NOW);
    }

    @Test
    @DisplayName("사용량 미터가 설정한 일수만큼 오늘까지 이어지면 → 사용량 화면의 30일 막대가 채워진다")
    void fillsDailyUsageUpToToday() {
        var usage = dataset().usage();

        assertThat(usage).hasSize(DEMO.usageDays());
        assertThat(usage.get(usage.size() - 1).day()).isEqualTo(LocalDate.ofInstant(NOW, ZoneOffset.UTC));
        assertThat(usage).allSatisfy(day -> assertThat(day.leases()).isPositive());
    }

    @Test
    @DisplayName("같은 시드·같은 시각으로 두 번 만들면 → 완전히 같은 데이터가 나온다(재시드가 중복이 아니라 대체가 된다)")
    void isDeterministic() {
        Dataset first = dataset();
        Dataset second = dataset();

        assertThat(second.snapshot()).isEqualTo(first.snapshot());
        assertThat(second.events()).isEqualTo(first.events());
        assertThat(second.samples()).isEqualTo(first.samples());
        assertThat(second.usage()).isEqualTo(first.usage());
    }

    @Test
    @DisplayName("시드를 바꾸면 → 다른 데이터가 나온다(시드가 실제로 쓰이는지 확인)")
    void seedActuallyVaries() {
        Dataset other = DemoScenario.build(
                new DemoDataProperties(true, "demo", 36, Duration.ofHours(48), 96, 30, 999L), ENGINE, NOW);

        assertThat(other.snapshot()).isNotEqualTo(dataset().snapshot());
    }
}
