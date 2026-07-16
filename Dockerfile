# Build the boot jar with the JDK 25 toolchain, then run it on a slim JRE 25 — a self-contained
# deployment unit (no host build prerequisite). The engine artifacts (core/persistence/grpc 0.3.0)
# resolve from Maven Central during the build stage.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /workspace
# Wrapper + build scripts first so the Gradle distribution download caches in its own layer and is
# not invalidated by source changes.
COPY gradlew ./
COPY gradle gradle
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
RUN ./gradlew --no-daemon help > /dev/null 2>&1 || true
COPY src src
RUN ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:25-jre AS run
WORKDIR /app
# curl backs the compose healthcheck against the actuator endpoint.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/build/libs/*.jar app.jar
# HTTP (actuator/health) and gRPC.
EXPOSE 8083 9093
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
