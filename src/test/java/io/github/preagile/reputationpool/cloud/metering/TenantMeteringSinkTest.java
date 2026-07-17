package io.github.preagile.reputationpool.cloud.metering;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.metering.MeterRecorder.Key;
import io.github.preagile.reputationpool.core.domain.Context;
import io.github.preagile.reputationpool.core.domain.PoolEvent;
import io.github.preagile.reputationpool.core.domain.ResourceId;
import io.github.preagile.reputationpool.core.domain.ResourceKind;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The metering sink must count only granted leases ({@code ResourceLeased}), attribute them to its
 * bound tenant, and bucket them by the event's UTC day — and ignore every other event.
 */
class TenantMeteringSinkTest {

    private static final ResourceId PROXY = new ResourceId(ResourceKind.PROXY, "p1");
    private static final Context SCRAPE = new Context("scrape");
    private static final Instant AT = Instant.parse("2026-07-17T10:00:00Z");

    @Test
    void countsGrantedLeasesForItsTenantByDay() {
        MeterRecorder recorder = new MeterRecorder();
        TenantMeteringSink sink = new TenantMeteringSink("acme", recorder);

        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT, AT.plusSeconds(30)));
        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT.plusSeconds(1), AT.plusSeconds(31)));

        // today = the events' day, so the bucket is kept (not a past day) and the count survives the drain.
        Map<Key, Long> deltas = recorder.drainLeaseDeltas(LocalDate.of(2026, 7, 17));
        assertThat(deltas).containsExactly(Map.entry(new Key("acme", LocalDate.of(2026, 7, 17)), 2L));
    }

    @Test
    void ignoresNonLeaseEvents() {
        MeterRecorder recorder = new MeterRecorder();
        TenantMeteringSink sink = new TenantMeteringSink("acme", recorder);

        sink.emit(new PoolEvent.LeaseReleased(PROXY, SCRAPE, AT));
        sink.emit(new PoolEvent.ResourceRecovered(PROXY, SCRAPE, AT));

        assertThat(recorder.drainLeaseDeltas(LocalDate.of(2026, 7, 17))).isEmpty();
    }

    @Test
    void drainResetsSoTheNextDrainStartsFromZero() {
        MeterRecorder recorder = new MeterRecorder();
        TenantMeteringSink sink = new TenantMeteringSink("acme", recorder);
        sink.emit(new PoolEvent.ResourceLeased(PROXY, SCRAPE, AT, AT.plusSeconds(30)));

        LocalDate today = LocalDate.of(2026, 7, 17);
        assertThat(recorder.drainLeaseDeltas(today)).isNotEmpty();
        assertThat(recorder.drainLeaseDeltas(today)).isEmpty();
    }
}
