import com.google.protobuf.gradle.id

plugins {
    java
    id("org.springframework.boot") version "3.5.3"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.diffplug.spotless") version "7.0.4"
    // Generates the protobuf message classes and the gRPC service stubs from src/main/proto.
    id("com.google.protobuf") version "0.10.0"
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

// Match what grpc-spring-boot-starter resolves so generated stubs and the runtime agree.
val grpcVersion = "1.63.0"
val protobufVersion = "3.25.1"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // DataSource (HikariCP) + Flyway auto-configuration for the persistence adapter's store/trail.
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")
    implementation("io.github.preagile:reputation-pool-core:0.2.1")
    implementation("io.github.preagile:reputation-pool-persistence:0.2.1")

    // gRPC codegen support. Versions match what grpc-spring-boot-starter resolves (grpc 1.63.0,
    // protobuf-java 3.25.1) so the generated stubs and the runtime agree.
    implementation("io.grpc:grpc-protobuf:$grpcVersion")
    implementation("io.grpc:grpc-stub:$grpcVersion")
    implementation("com.google.protobuf:protobuf-java:$protobufVersion")
    // The generated gRPC stubs carry a javax.annotation.Generated annotation; supply it at compile time
    // (Apache-2.0, as recommended by the grpc-java README).
    compileOnly("org.apache.tomcat:annotations-api:6.0.53")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    // In-process transport: the contract test rides the real gRPC wiring without sockets or ports.
    testImplementation("io.grpc:grpc-inprocess:$grpcVersion")
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
    plugins {
        id("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion"
        }
    }
    generateProtoTasks {
        all().forEach { task ->
            task.plugins {
                id("grpc")
            }
        }
    }
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
        // Only our hand-written sources — the generated protobuf/gRPC code under build/ is left
        // untouched (no formatting check), as in the public reputation-pool-server module.
        target("src/*/java/**/*.java")
        palantirJavaFormat()
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}
