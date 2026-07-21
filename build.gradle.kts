plugins {
    java
    id("org.springframework.boot") version "3.5.3"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.diffplug.spotless") version "7.0.4"
}

group = "io.github.preagile"
version = "0.1.0-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenLocal()
    mavenCentral()
}

// grpc-inprocess (test only) — the gRPC runtime + stubs come transitively from reputation-pool-grpc,
// whose baseline this matches.
val grpcVersion = "1.63.0"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // Renders the Micrometer meters (issue #45) in Prometheus text format at /actuator/prometheus, so an
    // external Prometheus can scrape them. Version is managed by the Spring Boot BOM.
    implementation("io.micrometer:micrometer-registry-prometheus")
    // DataSource (HikariCP) + Flyway auto-configuration for the persistence adapter's store/trail.
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")
    // Control-plane admin auth (issue #11): Spring Security guards the REST surface, and the
    // oauth2-resource-server starter validates the admin JWT. It also brings spring-security-oauth2-jose
    // (NimbusJwtEncoder + nimbus-jose-jwt) transitively, which issues the HS256 token on login — so no
    // extra JWT dependency is needed. gRPC (port 9093) keeps its own x-api-key interceptor; the servlet
    // security filter chain here only covers the HTTP control plane (port 8083).
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    // 0.3.1 introduces per-pool namespacing: the PostgresResourceStore(dataSource, clock, poolId)
    // constructor and the gRPC service's protected pool() routing hook that per-tenant isolation needs.
    implementation("io.github.preagile:reputation-pool-core:0.3.1")
    implementation("io.github.preagile:reputation-pool-persistence:0.3.1")
    // The gRPC contract + adapter (proto stubs, mapping, broadcaster, advisor service base). Brings
    // grpc-protobuf/grpc-stub/protobuf-java transitively, so cloud adds no codegen of its own.
    implementation("io.github.preagile:reputation-pool-grpc:0.3.1")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    // MockMvc security helpers (SecurityMockMvcRequestPostProcessors, etc.) for the control-plane slice test.
    testImplementation("org.springframework.security:spring-security-test")
    // In-process transport: cloud's gRPC service test rides the real wiring without sockets or ports.
    testImplementation("io.grpc:grpc-inprocess:$grpcVersion")
}

// Integration tests that need a real PostgreSQL run in their own source set, off the `build` gate, so
// `./gradlew build` stays Docker-free (mirrors the public reputation-pool-persistence module). The
// `integrationTest` task below runs them on demand and in CI, where Docker exists.
val integrationTest =
    sourceSets.create("integrationTest") {
        compileClasspath += sourceSets.main.get().output + sourceSets.test.get().output
        runtimeClasspath += sourceSets.main.get().output + sourceSets.test.get().output
    }

configurations["integrationTestImplementation"].extendsFrom(configurations.testImplementation.get())
configurations["integrationTestRuntimeOnly"].extendsFrom(configurations.testRuntimeOnly.get())

dependencies {
    // Testcontainers versions are managed by the Spring Boot BOM, so no explicit versions here.
    "integrationTestImplementation"("org.springframework.boot:spring-boot-testcontainers")
    "integrationTestImplementation"("org.testcontainers:postgresql")
    "integrationTestImplementation"("org.testcontainers:junit-jupiter")
}

tasks.withType<Test> {
    useJUnitPlatform()
}

// cloud is an application, not a library: keep only the executable boot jar so the Docker image copies
// one unambiguous artifact (no `-plain.jar` alongside it).
tasks.named<Jar>("jar") {
    enabled = false
}

// On-demand only: `./gradlew integrationTest`. Needs a Docker daemon (Testcontainers PostgreSQL).
val integrationTestTask =
    tasks.register<Test>("integrationTest") {
        description = "Runs Testcontainers integration tests against a real PostgreSQL. Requires Docker."
        group = "verification"
        testClassesDirs = integrationTest.output.classesDirs
        classpath = integrationTest.runtimeClasspath
        shouldRunAfter(tasks.test)
    }

spotless {
    kotlinGradle {
        ktlint()
        trimTrailingWhitespace()
        endWithNewline()
    }
    java {
        palantirJavaFormat("2.96.0")
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}
