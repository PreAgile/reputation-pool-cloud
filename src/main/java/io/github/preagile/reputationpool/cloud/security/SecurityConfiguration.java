package io.github.preagile.reputationpool.cloud.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.OctetSequenceKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import io.micrometer.core.instrument.MeterRegistry;
import java.security.SecureRandom;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.actuate.autoconfigure.security.servlet.EndpointRequest;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.actuate.info.InfoEndpoint;
import org.springframework.boot.actuate.metrics.export.prometheus.PrometheusScrapeEndpoint;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Spring Security for the REST control plane (issue #11) — the first HTTP-facing security in cloud.
 *
 * <p><b>Scope.</b> This is the <em>servlet</em> filter chain, so it guards only the HTTP surface on
 * {@code server.port} (8083). The gRPC data plane runs on its own Netty server ({@code grpc.server.port}
 * 9093) with its own {@link ApiKeyAuthInterceptor}; it is not a servlet request and is untouched here —
 * exactly the isolation the plan requires (gRPC excluded from JWT auth). This chain has no {@code
 * securityMatcher}, so it governs <em>every</em> servlet path — not just {@code /api/**} — which is why
 * an unmapped path outside any known prefix is denied by default rather than falling through unguarded.
 * Actuator {@code health}/{@code info} stay public for probes; {@code POST /api/auth/login} is public so
 * an admin can obtain a token; every other request requires a valid admin JWT.
 *
 * <p><b>Stateless.</b> The API is token-only: no session, no CSRF token (there is no cookie/session to
 * protect), no form login or HTTP Basic. A caller either presents a valid {@code Authorization: Bearer}
 * JWT or is rejected with 401.
 *
 * <p><b>Signing key.</b> The HS256 key is the configured {@code reputation-pool.admin.jwt-secret}. When
 * it is set it must be at least 256 bits (fail fast on a too-short secret — a silent stretch would mask
 * misconfiguration). When it is unset the console is disabled: an <em>ephemeral</em> random key is used
 * so the encoder/decoder beans exist (the app still boots for gRPC) but no externally minted token can
 * ever validate, and {@link AdminTokenService} refuses to issue one. Same key drives both issuing
 * ({@link JwtEncoder}) and verifying ({@link JwtDecoder}); the secret never leaves this process.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({AdminAuthProperties.class, LoginThrottleProperties.class})
public class SecurityConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SecurityConfiguration.class);

    @Bean
    SecurityFilterChain controlPlaneSecurity(
            HttpSecurity http, JwtDecoder jwtDecoder, LoginThrottleFilter loginThrottleFilter) throws Exception {
        return http.csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(
                        // health/info: liveness·readiness probes and the dashboard health card. prometheus
                        // (#14): the metrics scrape is permitAll so an in-cluster Prometheus can pull it
                        // without a bearer token — the trust boundary is the network: the app binds
                        // loopback-only and Caddy does NOT route /actuator/prometheus to the outside, so
                        // this endpoint is reachable only from inside the compose network.
                        auth -> auth.requestMatchers(EndpointRequest.to(
                                        HealthEndpoint.class, InfoEndpoint.class, PrometheusScrapeEndpoint.class))
                                .permitAll()
                                .requestMatchers("/api/auth/login")
                                .permitAll()
                                .anyRequest()
                                .authenticated())
                // Brute-force defence (issue #28): runs after login is admitted by permitAll but before any
                // JWT authentication, so a blocked IP is answered with 429 before touching the controller.
                .addFilterBefore(loginThrottleFilter, BearerTokenAuthenticationFilter.class)
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.decoder(jwtDecoder)))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .build();
    }

    /** The IP-based login limiter (issue #28); {@link Clock}-driven so expiry/unblock are testable. */
    @Bean
    LoginThrottle loginThrottle(LoginThrottleProperties properties, java.time.Clock clock) {
        return new LoginThrottle(properties, clock);
    }

    @Bean
    LoginThrottleFilter loginThrottleFilter(
            LoginThrottle loginThrottle, MeterRegistry meterRegistry, ObjectMapper objectMapper) {
        return new LoginThrottleFilter(loginThrottle, meterRegistry, objectMapper);
    }

    /**
     * The HS256 signing key: the configured secret when present (min 256 bits), else an ephemeral random
     * key that disables the console. Shared by the encoder and decoder so issue and verify agree.
     */
    @Bean
    SecretKey adminJwtKey(AdminAuthProperties properties) {
        if (properties.jwtSecret().isBlank()) {
            log.warn("no reputation-pool.admin.jwt-secret configured — admin control plane disabled "
                    + "(login cannot mint a token; all /api/** calls rejected). gRPC data plane is unaffected.");
            byte[] ephemeral = new byte[AdminAuthProperties.MIN_SECRET_BYTES];
            new SecureRandom().nextBytes(ephemeral);
            return new SecretKeySpec(ephemeral, "HmacSHA256");
        }
        byte[] secret = properties.jwtSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (secret.length < AdminAuthProperties.MIN_SECRET_BYTES) {
            throw new IllegalStateException("reputation-pool.admin.jwt-secret must be at least "
                    + AdminAuthProperties.MIN_SECRET_BYTES + " bytes (HS256 needs a 256-bit key)");
        }
        return new SecretKeySpec(secret, "HmacSHA256");
    }

    @Bean
    JwtDecoder adminJwtDecoder(SecretKey adminJwtKey) {
        return NimbusJwtDecoder.withSecretKey(adminJwtKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
    }

    @Bean
    JwtEncoder adminJwtEncoder(SecretKey adminJwtKey) {
        JWKSource<SecurityContext> jwks =
                new ImmutableJWKSet<>(new com.nimbusds.jose.jwk.JWKSet(new OctetSequenceKey.Builder(adminJwtKey)
                        .algorithm(com.nimbusds.jose.JWSAlgorithm.HS256)
                        .build()));
        return new NimbusJwtEncoder(jwks);
    }

    @Bean
    AdminTokenService adminTokenService(
            JwtEncoder adminJwtEncoder, AdminAuthProperties properties, java.time.Clock clock) {
        return new AdminTokenService(adminJwtEncoder, properties, clock);
    }

    @Bean
    ApiKeyManagementService apiKeyManagementService(DataSource dataSource, java.time.Clock clock) {
        return new ApiKeyManagementService(dataSource, clock);
    }
}
