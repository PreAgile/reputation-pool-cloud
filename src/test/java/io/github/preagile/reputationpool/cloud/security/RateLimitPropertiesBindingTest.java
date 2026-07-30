package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/**
 * 설정이 **배포가 실제로 주입하는 값**으로 바인딩되는지 본다 (#132 리뷰).
 *
 * <p><b>이 테스트가 왜 필요한가.</b> 이 조합은 두 CI 게이트 사이로 빠져나간다. {@code Build & Test} 는
 * 환경변수 없이 돌아 "미정의 → {@code @DefaultValue} 적용" 경로만 타고, {@code Deploy config} 는
 * {@code docker compose config} 로 파싱만 한다. 컨테이너를 실제로 띄워야 드러나는 문제라 아무도 못 잡았다.
 *
 * <p>실제로 있었던 사고: compose 가 세 변수를 {@code ${VAR:-}} 로 넘겼는데, 이 문법은 변수를 생략하는
 * 것이 아니라 <b>빈 문자열</b>을 넣는다. Spring 은 ""를 primitive 로 변환하지 못하고 null 을 대입하려다
 * 죽으며, {@code @DefaultValue} 는 속성이 <em>아예 없을 때만</em> 적용되므로 구제하지 못한다.
 * {@code .env.example} 이 세 변수를 주석 처리해 두었으므로 그대로 복사한 <b>모든 호스트가 기본 경로에서</b>
 * 기동 실패했다.
 */
@DisplayName("RateLimitProperties(바인딩): 배포가 주입하는 값으로 설정이 실제로 바인딩되는지")
class RateLimitPropertiesBindingTest {

    /** `KEY: ${KEY:-default}` 에서 KEY 와 default 를 뽑는다. `:-` 뒤가 비어 있으면 default 가 빈 문자열이다. */
    private static final Pattern COMPOSE_ENV =
            Pattern.compile("^\\s*(REPUTATION_POOL_RATE_LIMIT_[A-Z_]+):\\s*\\$\\{[A-Z_]+:-(.*)}\\s*$");

    private static RateLimitProperties bind(Map<String, String> source) {
        return new Binder(new MapConfigurationPropertySource(new LinkedHashMap<>(source)))
                .bindOrCreate("reputation-pool.rate-limit", Bindable.of(RateLimitProperties.class));
    }

    /** 환경변수 이름을 Spring relaxed binding 의 속성 이름으로. */
    private static String toPropertyName(String envVar) {
        return "reputation-pool.rate-limit."
                + envVar.substring("REPUTATION_POOL_RATE_LIMIT_".length())
                        .toLowerCase()
                        .replace('_', '-');
    }

    @Test
    @DisplayName("세 변수를 아예 지정하지 않으면 → 기본값(true/10/50)으로 바인딩된다")
    void unsetBindsToDefaults() {
        RateLimitProperties props = bind(Map.of());

        assertThat(props.enabled()).isTrue();
        assertThat(props.requestsPerSecond()).isEqualTo(10.0d);
        assertThat(props.burst()).isEqualTo(50);
    }

    @Test
    @DisplayName("compose.yaml 이 미설정 시 넣는 값 그대로 바인딩하면 → 기동에 실패하지 않고 기본값과 같아진다")
    void composeDefaultsBindAndMatchTheJavaDefaults() throws IOException {
        // compose 를 손으로 옮겨 적지 않고 **파일에서 읽는다.** 그래야 이 테스트가 두 가지를 동시에 잡는다:
        //   - `${VAR:-}` 로 되돌아가면 → 빈 문자열이 바인딩돼 BindException 으로 여기서 터진다
        //   - compose 기본값과 @DefaultValue 가 갈라지면 → 아래 등식이 깨진다
        Map<String, String> fromCompose = new LinkedHashMap<>();
        for (String line : Files.readAllLines(Path.of("compose.yaml"))) {
            Matcher m = COMPOSE_ENV.matcher(line);
            if (m.matches()) {
                fromCompose.put(toPropertyName(m.group(1)), m.group(2));
            }
        }

        assertThat(fromCompose)
                .as("compose.yaml 에서 rate-limit 환경변수 세 개를 찾지 못했다 — 이름이 바뀌었는지 확인한다")
                .hasSize(3);
        assertThat(fromCompose.values())
                .as("`${VAR:-}` 는 빈 문자열을 주입해 primitive 바인딩을 깨뜨린다 — 기본값을 명시해야 한다")
                .noneMatch(String::isEmpty);

        assertThat(bind(fromCompose)).isEqualTo(bind(Map.of()));
    }

    @Test
    @DisplayName("requests-per-second 가 NaN·Infinity 면 → 기동 시점에 죽는다 (런타임 전면 차단으로 새지 않는다)")
    void rejectsNonFiniteRate() {
        // `NaN <= 0` 은 false 라 `> 0` 검사만으로는 통과한다. 통과하면 tokens 가 NaN 으로 오염돼
        // 모든 테넌트가 영구 거부되고, Retry-After 는 `(long) Math.ceil(NaN) == 0` → max(1,0) = 1 이라
        // "1초 뒤 오세요" 라는 거짓말이 붙는다.
        for (String bad : new String[] {"NaN", "Infinity", "-Infinity"}) {
            assertThatThrownBy(() -> bind(Map.of("reputation-pool.rate-limit.requests-per-second", bad)))
                    .as("requests-per-second=%s", bad)
                    .hasRootCauseInstanceOf(IllegalArgumentException.class)
                    .rootCause()
                    .hasMessageContaining("finite");
        }
    }

    @Test
    @DisplayName("값을 실제로 주면 → 그 값으로 바인딩된다 (기본값 처리가 정상 경로를 덮지 않는다)")
    void explicitValuesWin() {
        Map<String, String> given = new LinkedHashMap<>();
        given.put("reputation-pool.rate-limit.enabled", "false");
        given.put("reputation-pool.rate-limit.requests-per-second", "2.5");
        given.put("reputation-pool.rate-limit.burst", "7");

        RateLimitProperties props = bind(given);

        assertThat(props.enabled()).isFalse();
        assertThat(props.requestsPerSecond()).isEqualTo(2.5d);
        assertThat(props.burst()).isEqualTo(7);
    }
}
