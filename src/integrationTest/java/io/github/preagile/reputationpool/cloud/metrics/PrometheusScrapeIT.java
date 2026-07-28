package io.github.preagile.reputationpool.cloud.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Outcome;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.devh.boot.grpc.server.serverfactory.GrpcServerFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Full-context integration test for the Prometheus scrape endpoint against a real PostgreSQL
 * (Testcontainers). Proves the endpoint is reachable without a token and exposes the pool's counters:
 *
 * <ul>
 *   <li><b>permitAll for the scraper (#14):</b> {@code /actuator/prometheus} joins health/info in the
 *       permitAll set, so an in-cluster Prometheus can pull it with no bearer token. The trust boundary
 *       is the network — the app binds loopback-only and Caddy does not route this path to the outside,
 *       so it is reachable only from inside the compose network (verified operationally, not here).
 *   <li><b>Counters are registered (#45):</b> the scrape body carries the {@link MetricsEventSink}
 *       counters (pre-registered at 0), proving the sink's meters reach the endpoint.
 * </ul>
 *
 * <p>{@code grpc.server.port=0} keeps this context off the fixed gRPC port so it can coexist with other IT
 * contexts. Requires Docker; runs via {@code ./gradlew integrationTest}, off the {@code build} gate.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=integration-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            "grpc.server.port=0"
        })
@DisplayName("PrometheusScrapeIT: /actuator/prometheus 가 토큰 없이 스크레이프되고 reputation 카운터를 노출하는지 종단 검증하는 통합테스트")
@Import(PrometheusScrapeIT.Containers.class)
class PrometheusScrapeIT {

    @TestConfiguration(proxyBeanMethods = false)
    static class Containers {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:17");
        }
    }

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private GrpcServerFactory grpcServerFactory;

    @Test
    @DisplayName("토큰 없이 /actuator/prometheus 를 호출하면 → 200 과 함께 reputation 카운터가 노출된다 (permitAll · 내부 스크레이프)")
    void scrapeIsReachableWithoutTokenAndExposesCounters() {
        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Micrometer renders reputation.resource.blocklisted -> reputation_resource_blocklisted_total.
        // Pre-registered at 0, so it is present even before any pool event fires.
        assertThat(res.getBody())
                .contains("reputation_resource_blocklisted_total")
                .contains("reputation_lease_granted_total");
    }

    @Test
    @DisplayName("스크레이프하면 → 급증 알림 임계값 게이지가 alerts.yml 이 참조하는 이름 그대로 노출된다 (issue #77)")
    void scrapeExposesSurgeThresholdGaugesUnderTheNamesTheRulesReference() {
        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        // monitoring/alerts.yml compares against these two series by name, so a rename or a Micrometer
        // suffix change would silently disable ResourceCoolingSurge / UpstreamBlockingSurge — a broken
        // alert that stays quiet. Pinning the rendered names here makes that a failing test instead.
        // Gauges carry no `_total` suffix (that is a counter convention), which is why the rule
        // expressions use the bare names.
        assertThat(res.getBody())
                .contains("reputation_alert_cooling_surge_threshold")
                .contains("reputation_alert_blocking_surge_threshold");
    }

    @Test
    @DisplayName("스크레이프하면 → 체크포인트 신선도 지표가 alerts.yml 이 참조하는 이름 그대로 노출된다 (issue #80)")
    void scrapeExposesCheckpointFreshnessMetricsUnderTheNamesTheRulesReference() {
        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        // CheckpointStale/PoolRestoreFailed 가 이 이름들로 비교하므로, 이름이 바뀌면 알림이 조용히 죽는다.
        // 게이지에는 _total 접미사가 붙지 않고 카운터에는 붙는다는 것까지 여기서 고정한다 — 룰 표현식이
        // 그 차이에 의존한다.
        assertThat(res.getBody())
                .contains("reputation_pool_checkpoint_age_seconds")
                .contains("reputation_pool_checkpoint_interval_seconds")
                .contains("reputation_pool_checkpoint_failures_total")
                .contains("reputation_pool_restore_failures_total");
    }

    @Test
    @DisplayName("gRPC 호출 후 스크레이프하면 → 처리시간 히스토그램 버킷과 SLO 룰이 쓰는 method/methodType 태그가 노출된다"
            + " (issue #78, grpc.server.processing.duration percentiles-histogram)")
    void grpcCallIsScrapedWithProcessingDurationHistogramBuckets() {
        // net.devh's GrpcServerMetricAutoConfiguration is already active (MeterRegistry + Micrometer's
        // MetricCollectingServerInterceptor are both on the classpath), so every RPC is timed without any
        // cloud-side wiring — these calls just need to happen so the timer records at least one sample.
        // All three unary RPCs the SLI definitions select on (monitoring/slo-rules.yml: the latency SLI
        // filters method=~"Acquire|Report", the availability SLI filters methodType!="SERVER_STREAMING")
        // are exercised, so this test fails if a tag name or value those rules depend on ever changes.
        // (#79 moved those selectors from alerts.yml into the recording rules; the tags are the same.)
        ManagedChannel channel = ManagedChannelBuilder.forAddress("localhost", grpcServerFactory.getPort())
                .usePlaintext()
                .build();
        try {
            Metadata md = new Metadata();
            md.put(Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER), "integration-key");
            ReputationAdvisorGrpc.ReputationAdvisorBlockingStub stub = ReputationAdvisorGrpc.newBlockingStub(channel)
                    .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));

            ResourceId resource = ResourceId.newBuilder()
                    .setKind(ResourceKind.PROXY)
                    .setValue("sli-probe")
                    .build();
            stub.register(RegisterRequest.newBuilder().setResource(resource).build());
            stub.acquire(AcquireRequest.newBuilder()
                    .setContext(Context.newBuilder().setValue("scrape"))
                    .build());
            stub.report(ReportRequest.newBuilder()
                    .setResource(resource)
                    .setContext(Context.newBuilder().setValue("scrape"))
                    .setOutcome(Outcome.newBuilder().setSuccess(Outcome.Success.getDefaultInstance()))
                    .build());
        } finally {
            channel.shutdownNow();
        }

        ResponseEntity<String> res = rest.getForEntity("/actuator/prometheus", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody())
                .contains("grpc_server_processing_duration_seconds_bucket")
                .contains("method=\"Register\"")
                .contains("method=\"Acquire\"")
                .contains("method=\"Report\"")
                // GrpcHighErrorRate excludes SubscribeEvents by methodType, so pin that tag's spelling too.
                .contains("methodType=\"UNARY\"")
                .contains("statusCode=\"OK\"");
    }

    @Test
    @DisplayName("스크레이프하면 → 지연 SLI 가 읽는 le=\"0.5\" 버킷이 두 타이머 모두에 노출된다" + " (issue #79, distribution.slo)")
    void scrapeExposesTheExactHalfSecondBucketBothLatencySlisRead() {
        // 지연 SLO 를 소진율로 재려면 "500ms 이내 비율" 이 필요하고, PromQL 로는 누적 버킷 하나를 읽는다:
        // ..._bucket{le="0.5"}. 그 시계열은 500ms 가 **실제 버킷 경계일 때만** 존재한다.
        //
        // percentiles-histogram 만으로는 생기지 않는다: Timer 기본 범위(1ms~30s)에서 66개 버킷이 만들어지고
        // 그 중 0.5s 는 없다(인접값 0.447392 / 0.536871). 그래서 application.yml 이 distribution.slo 로
        // 경계를 하나 추가한다. 그것을 지우면 slo-rules.yml 의 지연 비율 분자가 빈 벡터가 되고
        // GrpcLatencyBudgetBurn* / HttpLatencyBudgetBurn* 이 **조용히** 무동작한다 — #78 이전
        // HighRequestLatencyP99 가 겪었던 것과 같은 실패 모드다. 그래서 렌더된 라벨 문자열까지 여기서 고정한다.
        ManagedChannel channel = ManagedChannelBuilder.forAddress("localhost", grpcServerFactory.getPort())
                .usePlaintext()
                .build();
        try {
            Metadata md = new Metadata();
            md.put(Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER), "integration-key");
            ReputationAdvisorGrpc.newBlockingStub(channel)
                    .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md))
                    .register(RegisterRequest.newBuilder()
                            .setResource(ResourceId.newBuilder()
                                    .setKind(ResourceKind.PROXY)
                                    .setValue("slo-bucket-probe")
                                    .build())
                            .build());
        } finally {
            channel.shutdownNow();
        }

        String body = rest.getForEntity("/actuator/prometheus", String.class).getBody();

        assertThat(bucketBoundaries(body, "grpc_server_processing_duration_seconds_bucket"))
                .as("gRPC 타이머의 le 경계 목록")
                .contains("0.5");
        assertThat(bucketBoundaries(body, "http_server_requests_seconds_bucket"))
                .as("HTTP 타이머의 le 경계 목록")
                .contains("0.5");
    }

    @Test
    @DisplayName("actuator 를 호출하면 → uri 라벨에 그 경로가 남는다" + " (issue #79, 컨트롤 플레인 SLI 가 actuator 를 걸러낼 수 있는 근거)")
    void actuatorRequestsCarryTheirUriLabelSoTheSliCanExcludeThem() {
        // 앱 헬스체크는 10초마다, Prometheus 스크레이프는 15초마다 actuator 를 때린다 — 합쳐 분당 약 10건의
        // 인공 요청이고 전부 200 이다. 실사용 트래픽이 적을 때 이것이 분모의 거의 전부가 되면 실제 5xx 가
        // 비율로 희석되어 컨트롤 플레인 SLI 가 실제보다 좋게 보인다.
        //
        // slo-rules.yml 은 `uri!~"/actuator.*"` 로 그것을 걸러내는데, 그 필터가 의미를 가지려면 actuator
        // 요청에 uri 라벨이 실제로 붙어야 한다. 붙지 않으면 필터는 무해하지만 **아무 것도 걸러내지 못하므로**
        // 오염이 남는다. 어느 쪽인지 추측하지 않고 여기서 확정한다.
        rest.getForEntity("/actuator/health", String.class);

        String body = rest.getForEntity("/actuator/prometheus", String.class).getBody();

        assertThat(body).contains("uri=\"/actuator/health\"");
    }

    /** {@code name} 계열 히스토그램 라인들에서 {@code le} 라벨 값만 뽑아낸다. */
    private static List<String> bucketBoundaries(String scrapeBody, String name) {
        return scrapeBody
                .lines()
                .filter(line -> line.startsWith(name + "{"))
                .map(LE_LABEL::matcher)
                .filter(Matcher::find)
                .map(m -> m.group(1))
                .toList();
    }

    private static final Pattern LE_LABEL = Pattern.compile("le=\"([^\"]+)\"");
}
