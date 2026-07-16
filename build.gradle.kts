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
    // DataSource (HikariCP) + Flyway auto-configuration for the persistence adapter's store/trail.
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")
    implementation("io.github.preagile:reputation-pool-core:0.3.0")
    implementation("io.github.preagile:reputation-pool-persistence:0.3.0")
    // The gRPC contract + adapter (proto stubs, mapping, broadcaster, advisor service base). Brings
    // grpc-protobuf/grpc-stub/protobuf-java transitively, so cloud adds no codegen of its own.
    implementation("io.github.preagile:reputation-pool-grpc:0.3.0")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
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
        palantirJavaFormat()
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}
