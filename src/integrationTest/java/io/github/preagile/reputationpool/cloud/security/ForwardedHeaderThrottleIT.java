package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * X-Forwarded-For가 로컬(부팅된 서버)에서 실제로 동작하는지 검증하는 통합 테스트.
 *
 * <p><b>무엇을 증명하나.</b> {@code server.forward-headers-strategy: framework}(application.yml)가
 * 설치하는 {@code ForwardedHeaderFilter}가 프록시가 보낸 {@code X-Forwarded-For}의 IP를
 * {@link jakarta.servlet.http.HttpServletRequest#getRemoteAddr()}에 반영하고, 로그인 브루트포스 방어
 * (#28, {@code LoginThrottleFilter})가 <b>그 IP를 기준으로</b> per-IP 카운터를 센다는 것.
 *
 * <p><b>왜 이 방식으로 증명되나.</b> {@link TestRestTemplate}은 모든 요청을 같은 소켓 주소
 * ({@code 127.0.0.1})에서 보낸다. 만약 XFF가 반영되지 <b>않는다면</b> 모든 요청이 하나의 IP로 묶여
 * 카운터를 공유하므로, IP A가 차단된 뒤에는 IP B로 위장한 요청도 곧바로 429가 나와야 한다. 반대로
 * XFF가 반영<b>된다면</b> A와 B는 독립 카운터를 가지므로 A가 차단돼도 B의 첫 실패는 여전히 401이다.
 * 따라서 "A 차단 후 B의 첫 시도가 429가 아니라 401"이면 XFF가 동작하는 것이다.
 *
 * <p>{@code max-attempts=2}로 낮춰 빠르게 트립시킨다. Docker 필요({@code ./gradlew integrationTest}).
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "reputation-pool.auth.api-key=integration-key",
            "reputation-pool.admin.username=admin",
            "reputation-pool.admin.password=s3cret-password",
            "reputation-pool.admin.tenant=default",
            "reputation-pool.admin.jwt-secret=0123456789abcdef0123456789abcdef",
            // 스로틀을 빨리 트립시키기 위해 임계치를 낮춘다(기본 5 → 2).
            "reputation-pool.admin.login-throttle.max-attempts=2",
            "grpc.server.port=0"
        })
@Import(ForwardedHeaderThrottleIT.Containers.class)
class ForwardedHeaderThrottleIT {

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

    /** 주어진 X-Forwarded-For로 (틀린 비밀번호) 로그인을 시도한다. */
    private ResponseEntity<String> loginFrom(String forwardedFor) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Forwarded-For", forwardedFor);
        HttpEntity<String> req = new HttpEntity<>("{\"username\":\"admin\",\"password\":\"wrong\"}", headers);
        return rest.exchange("/api/auth/login", HttpMethod.POST, req, String.class);
    }

    @Test
    void xForwardedFor_isRespected_soEachSpoofedIpGetsItsOwnThrottleCounter() {
        String ipA = "203.0.113.10";
        String ipB = "198.51.100.20";

        // 1) IP A로 차단될 때까지 시도. 차단 전엔 자격 오류(401), 차단되면 429 + Retry-After.
        boolean ipABlocked = false;
        String retryAfter = null;
        for (int i = 0; i < 6 && !ipABlocked; i++) {
            ResponseEntity<String> resp = loginFrom(ipA);
            if (resp.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                ipABlocked = true;
                retryAfter = resp.getHeaders().getFirst(HttpHeaders.RETRY_AFTER);
            } else {
                assertThat(resp.getStatusCode())
                        .as("차단 전에는 자격 오류(401)여야 한다")
                        .isEqualTo(HttpStatus.UNAUTHORIZED);
            }
        }
        assertThat(ipABlocked).as("IP A는 max-attempts 초과 후 429로 차단돼야 한다").isTrue();
        assertThat(retryAfter).as("429에는 Retry-After 헤더가 있어야 한다").isNotNull();

        // 2) 핵심 증명 — IP A가 차단된 상태에서, 다른 XFF(IP B)의 첫 시도는 429가 아니라 401이어야 한다.
        //    XFF가 무시된다면 모든 요청이 127.0.0.1로 묶여 이미 차단됐을 것이므로 429가 나올 것이다.
        //    401이 나온다 = A와 B가 독립 카운터를 가진다 = XFF가 getRemoteAddr에 반영된다.
        ResponseEntity<String> ipBFirstTry = loginFrom(ipB);
        assertThat(ipBFirstTry.getStatusCode())
                .as("다른 XFF(IP B)는 독립 카운터를 가지므로 첫 시도는 401이어야 한다(429 아님) — XFF 반영 증명")
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
