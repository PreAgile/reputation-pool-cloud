package io.github.preagile.reputationpool.cloud.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.FailureType;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The metrics sink must map each pool state transition to the right Micrometer counter, tag COOLING with
 * its (bounded) cause, ignore events out of scope, and — honouring the non-blocking {@code EventSink}
 * contract — never throw back at the engine. Backed by a {@link SimpleMeterRegistry}, so no scrape server.
 */
@DisplayName("MetricsEventSink: 풀 상태 전이를 Micrometer 카운터로 집계하는 메트릭 싱크")
class MetricsEventSinkTest {

    private static final ResourceId PROXY = new ResourceId(ResourceKind.PROXY, "p1");
    private static final Context SCRAPE = new Context("scrape");
    private static final Instant AT = Instant.parse("2026-07-20T10:00:00Z");

    private double count(SimpleMeterRegistry registry, String name, String... tags) {
        return registry.get(name).tags(tags).counter().count();
    }

    @Test
    @DisplayName("생성 직후 아무 이벤트도 없으면 → 모든 카운터가 0 으로 미리 등록돼 있다")
    void preRegistersCountersAtZero() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        new MetricsEventSink(registry);

        assertThat(count(registry, MetricsEventSink.LEASE_GRANTED)).isZero();
        assertThat(count(registry, MetricsEventSink.BLOCKLISTED)).isZero();
        assertThat(count(registry, MetricsEventSink.UNBLOCKED)).isZero();
        assertThat(count(registry, MetricsEventSink.RECOVERED)).isZero();
        // The cause-tagged cooled counter is pre-registered for every FailureType, so each is visible at 0
        // before any COOLING event fires (no metric-absence gaps in dashboards/alerts).
        for (FailureType cause : FailureType.values()) {
            assertThat(count(registry, MetricsEventSink.COOLED, "cause", cause.name()))
                    .isZero();
        }
    }

    @Test
    @DisplayName("각 상태 전이 이벤트가 오면 → 대응하는 카운터가 하나씩 증가한다")
    void incrementsCounterPerEventType() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        MetricsEventSink sink = new MetricsEventSink(registry);

        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT, AT.plusSeconds(30)));
        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT, AT.plusSeconds(30)));
        sink.emit(new PoolEvent.ResourceBlocklisted(PROXY, AT, AT.plusSeconds(60)));
        sink.emit(new PoolEvent.ResourceUnblocked(PROXY, AT));
        sink.emit(new PoolEvent.ResourceRecovered(PROXY, SCRAPE, AT));

        assertThat(count(registry, MetricsEventSink.LEASE_GRANTED)).isEqualTo(2);
        assertThat(count(registry, MetricsEventSink.BLOCKLISTED)).isEqualTo(1);
        assertThat(count(registry, MetricsEventSink.UNBLOCKED)).isEqualTo(1);
        assertThat(count(registry, MetricsEventSink.RECOVERED)).isEqualTo(1);
    }

    @Test
    @DisplayName("COOLING 진입 이벤트는 → cause 를 태그로 달아 원인별로 집계한다")
    void tagsCooledByCause() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        MetricsEventSink sink = new MetricsEventSink(registry);

        sink.emit(new PoolEvent.ResourceCooled(PROXY, SCRAPE, AT, AT.plusSeconds(120), FailureType.TIMEOUT));
        sink.emit(new PoolEvent.ResourceCooled(PROXY, SCRAPE, AT, AT.plusSeconds(120), FailureType.TIMEOUT));
        sink.emit(new PoolEvent.ResourceCooled(PROXY, SCRAPE, AT, AT.plusSeconds(120), FailureType.BLOCKED));

        assertThat(count(registry, MetricsEventSink.COOLED, "cause", "TIMEOUT")).isEqualTo(2);
        assertThat(count(registry, MetricsEventSink.COOLED, "cause", "BLOCKED")).isEqualTo(1);
    }

    @Test
    @DisplayName("집계 대상이 아닌 이벤트(LeaseReleased)는 → 어떤 카운터도 건드리지 않는다")
    void ignoresUncountedEvents() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        MetricsEventSink sink = new MetricsEventSink(registry);

        sink.emit(new PoolEvent.LeaseReleased(PROXY, SCRAPE, AT));

        assertThat(count(registry, MetricsEventSink.LEASE_GRANTED)).isZero();
        assertThat(count(registry, MetricsEventSink.BLOCKLISTED)).isZero();
        assertThat(count(registry, MetricsEventSink.UNBLOCKED)).isZero();
        assertThat(count(registry, MetricsEventSink.RECOVERED)).isZero();
    }
}
