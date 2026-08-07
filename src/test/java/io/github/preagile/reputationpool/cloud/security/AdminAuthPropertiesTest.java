package io.github.preagile.reputationpool.cloud.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.preagile.reputationpool.cloud.security.AdminAuthProperties.Account;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SystemEnvironmentPropertySource;

@DisplayName("AdminAuthProperties: 단일 관리자 로그인을 역할 있는 다중 계정으로 확장한 설정 — 기존 키의 의미는 그대로 둔다")
class AdminAuthPropertiesTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    private static AdminAuthProperties properties(String user, String password, List<Account> accounts) {
        return new AdminAuthProperties(user, password, "default", SECRET, Duration.ofHours(1), accounts);
    }

    @Nested
    @DisplayName("기존 단일 계정 설정만 있을 때")
    class WhenOnlyLegacyAccount {

        @Test
        @DisplayName("username·password 만 설정하면 → 전권(ADMIN) 계정 하나로 동작한다(회귀 없음)")
        void legacyAccountIsAdmin() {
            AdminAuthProperties props = properties("admin", "s3cret", List.of());

            assertThat(props.configured()).isTrue();
            assertThat(props.allAccounts()).singleElement().satisfies(account -> {
                assertThat(account.username()).isEqualTo("admin");
                assertThat(account.tenant()).isEqualTo("default");
                assertThat(account.role()).isEqualTo(AdminRole.ADMIN);
            });
        }

        @Test
        @DisplayName("username 이나 password 가 비어 있으면 → 계정이 하나도 없어 콘솔은 미설정(fail closed)이다")
        void blankLegacyCredentialDisablesConsole() {
            assertThat(properties("admin", "", List.of()).configured()).isFalse();
            assertThat(properties("", "s3cret", List.of()).configured()).isFalse();
            assertThat(properties("", "", List.of()).allAccounts()).isEmpty();
        }

        @Test
        @DisplayName("서명 시크릿이 비어 있으면 → 계정이 있어도 콘솔은 미설정이다")
        void blankSecretDisablesConsole() {
            AdminAuthProperties props =
                    new AdminAuthProperties("admin", "s3cret", "default", "", Duration.ofHours(1), List.of());

            assertThat(props.configured()).isFalse();
        }
    }

    @Nested
    @DisplayName("추가 계정을 설정했을 때")
    class WhenExtraAccounts {

        @Test
        @DisplayName("읽기 전용 계정을 덧붙이면 → 기존 전권 계정과 나란히 두 계정이 되고 각자의 테넌트·역할을 갖는다")
        void extraAccountsCoexistWithLegacy() {
            AdminAuthProperties props = properties(
                    "admin", "s3cret", List.of(new Account("observer", "watch", "demo", AdminRole.READ_ONLY)));

            assertThat(props.allAccounts())
                    .extracting(Account::username, Account::tenant, Account::role)
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple("admin", "default", AdminRole.ADMIN),
                            org.assertj.core.groups.Tuple.tuple("observer", "demo", AdminRole.READ_ONLY));
        }

        @Test
        @DisplayName("기존 단일 계정 없이 추가 계정만 설정해도 → 그 계정만으로 콘솔이 동작한다")
        void extraAccountsAloneAreEnough() {
            AdminAuthProperties props =
                    properties("", "", List.of(new Account("observer", "watch", "demo", AdminRole.READ_ONLY)));

            assertThat(props.configured()).isTrue();
            assertThat(props.allAccounts())
                    .singleElement()
                    .extracting(Account::username)
                    .isEqualTo("observer");
        }

        @Test
        @DisplayName("자격증명이 반쯤 비어 있는 항목은 → 빈 비밀번호로 로그인되지 않도록 계정 목록에서 버린다")
        void halfWrittenAccountsAreDropped() {
            AdminAuthProperties props = properties(
                    "",
                    "",
                    List.of(
                            new Account("no-password", "", "demo", AdminRole.READ_ONLY),
                            new Account("", "no-username", "demo", AdminRole.READ_ONLY),
                            new Account("ok", "pw", "demo", AdminRole.READ_ONLY)));

            assertThat(props.allAccounts())
                    .singleElement()
                    .extracting(Account::username)
                    .isEqualTo("ok");
        }
    }

    @Nested
    @DisplayName("설정 바인딩")
    class Binding {

        @Test
        @DisplayName("accounts[n] 키로 계정을 주입하면 → 목록으로 바인딩되고 role 을 생략한 항목은 최소 권한(read-only)이 된다")
        void bindsIndexedAccounts() {
            new ApplicationContextRunner()
                    .withUserConfiguration(EnableProperties.class)
                    .withPropertyValues(
                            "reputation-pool.admin.username=admin",
                            "reputation-pool.admin.password=s3cret",
                            "reputation-pool.admin.jwt-secret=" + SECRET,
                            "reputation-pool.admin.accounts[0].username=observer",
                            "reputation-pool.admin.accounts[0].password=watch",
                            "reputation-pool.admin.accounts[0].tenant=demo",
                            "reputation-pool.admin.accounts[0].role=read-only",
                            "reputation-pool.admin.accounts[1].username=deputy",
                            "reputation-pool.admin.accounts[1].password=pw",
                            "reputation-pool.admin.accounts[1].role=admin",
                            "reputation-pool.admin.accounts[2].username=unstated",
                            "reputation-pool.admin.accounts[2].password=pw")
                    .run(context -> assertThat(
                                    context.getBean(AdminAuthProperties.class).allAccounts())
                            .extracting(Account::username, Account::tenant, Account::role)
                            .containsExactly(
                                    org.assertj.core.groups.Tuple.tuple("admin", "default", AdminRole.ADMIN),
                                    org.assertj.core.groups.Tuple.tuple("observer", "demo", AdminRole.READ_ONLY),
                                    org.assertj.core.groups.Tuple.tuple("deputy", "default", AdminRole.ADMIN),
                                    org.assertj.core.groups.Tuple.tuple("unstated", "default", AdminRole.READ_ONLY)));
        }

        @Test
        @DisplayName("Boot 의 환경변수 이완 바인딩은 하이픈 접두사 아래 인덱스 목록까지는 되짚지 못한다 → application.yml 이 슬롯을 펼쳐 두는 이유")
        void indexedListsDoNotBindFromEnvironmentVariableNames() {
            // 이 케이스는 우리 코드가 아니라 프레임워크의 한계를 고정한다. 실제 배포 경로가 `.env` → compose
            // → 환경변수이므로, 만약 언젠가 이것이 되기 시작하면 application.yml 의 슬롯 전개는 불필요해진다
            // — 그때 이 테스트가 빨개져서 알려 준다. 스칼라(username)는 되고 목록(accounts[0])은 안 된다.
            Map<String, Object> env = new java.util.HashMap<>();
            env.put("REPUTATION_POOL_ADMIN_USERNAME", "admin");
            env.put("REPUTATION_POOL_ADMIN_PASSWORD", "s3cret");
            env.put("REPUTATION_POOL_ADMIN_JWT_SECRET", SECRET);
            env.put("REPUTATION_POOL_ADMIN_ACCOUNTS_0_USERNAME", "observer");
            env.put("REPUTATION_POOL_ADMIN_ACCOUNTS_0_PASSWORD", "watch");

            new ApplicationContextRunner()
                    .withUserConfiguration(EnableProperties.class)
                    .withInitializer(context -> context.getEnvironment()
                            .getPropertySources()
                            .addFirst(new SystemEnvironmentPropertySource("test-systemEnvironment", env)))
                    .run(context -> assertThat(
                                    context.getBean(AdminAuthProperties.class).allAccounts())
                            .extracting(Account::username)
                            .containsExactly("admin"));
        }

        @Test
        @DisplayName("application.yml 이 펼쳐 둔 슬롯에 평범한 환경변수를 주면 → 읽기 전용 계정이 실제로 생긴다(운영자가 쓰는 경로)")
        void slotsBindFromPlainEnvironmentVariables() {
            Map<String, Object> env = new java.util.HashMap<>();
            env.put("REPUTATION_POOL_ADMIN_USERNAME", "admin");
            env.put("REPUTATION_POOL_ADMIN_PASSWORD", "s3cret");
            env.put("REPUTATION_POOL_ADMIN_JWT_SECRET", SECRET);
            env.put("REPUTATION_POOL_ADMIN_ACCOUNT_1_USERNAME", "observer");
            env.put("REPUTATION_POOL_ADMIN_ACCOUNT_1_PASSWORD", "watch");
            env.put("REPUTATION_POOL_ADMIN_ACCOUNT_1_TENANT", "demo");

            new ApplicationContextRunner()
                    .withUserConfiguration(EnableProperties.class)
                    // application.yml 의 슬롯 전개를 그대로 재현한다(슬라이스에는 그 파일이 없다).
                    .withPropertyValues(
                            "reputation-pool.admin.accounts[0].username=${REPUTATION_POOL_ADMIN_ACCOUNT_1_USERNAME:}",
                            "reputation-pool.admin.accounts[0].password=${REPUTATION_POOL_ADMIN_ACCOUNT_1_PASSWORD:}",
                            "reputation-pool.admin.accounts[0].tenant=${REPUTATION_POOL_ADMIN_ACCOUNT_1_TENANT:default}",
                            "reputation-pool.admin.accounts[0].role=${REPUTATION_POOL_ADMIN_ACCOUNT_1_ROLE:read-only}",
                            "reputation-pool.admin.accounts[1].username=${REPUTATION_POOL_ADMIN_ACCOUNT_2_USERNAME:}",
                            "reputation-pool.admin.accounts[1].password=${REPUTATION_POOL_ADMIN_ACCOUNT_2_PASSWORD:}",
                            "reputation-pool.admin.accounts[1].tenant=${REPUTATION_POOL_ADMIN_ACCOUNT_2_TENANT:default}",
                            "reputation-pool.admin.accounts[1].role=${REPUTATION_POOL_ADMIN_ACCOUNT_2_ROLE:read-only}")
                    .withInitializer(context -> context.getEnvironment()
                            .getPropertySources()
                            .addFirst(new SystemEnvironmentPropertySource("test-systemEnvironment", env)))
                    .run(context -> assertThat(
                                    context.getBean(AdminAuthProperties.class).allAccounts())
                            .as("두 번째 슬롯은 환경변수가 없으므로 비어 있고, 계정 목록에서 버려져야 한다")
                            .extracting(Account::username, Account::tenant, Account::role)
                            .containsExactly(
                                    org.assertj.core.groups.Tuple.tuple("admin", "default", AdminRole.ADMIN),
                                    org.assertj.core.groups.Tuple.tuple("observer", "demo", AdminRole.READ_ONLY)));
        }

        @Test
        @DisplayName("accounts 를 아예 설정하지 않으면 → 빈 목록으로 바인딩되어 기존 배포와 동일하게 단일 계정만 남는다")
        void absentAccountsBindToEmpty() {
            new ApplicationContextRunner()
                    .withUserConfiguration(EnableProperties.class)
                    .withPropertyValues(
                            "reputation-pool.admin.username=admin",
                            "reputation-pool.admin.password=s3cret",
                            "reputation-pool.admin.jwt-secret=" + SECRET)
                    .run(context -> {
                        AdminAuthProperties props = context.getBean(AdminAuthProperties.class);
                        assertThat(props.accounts()).isEmpty();
                        assertThat(props.allAccounts())
                                .singleElement()
                                .extracting(Account::role)
                                .isEqualTo(AdminRole.ADMIN);
                    });
        }
    }

    @EnableConfigurationProperties(AdminAuthProperties.class)
    static class EnableProperties {}
}
