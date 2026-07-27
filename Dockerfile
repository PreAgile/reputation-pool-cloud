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
# Heap is a share of the *container* limit, not the host (#15). Without a flag the JVM's container-aware
# default caps the heap near 1/4 of the limit — on a 12GB host with no compose limit that reserves ~3GB
# while eight containers compete for the same RAM, and it does not shrink if the deploy target drops to
# 1 OCPU/6GB. MaxRAMPercentage reads the cgroup limit, so `deploy.resources.limits.memory` in
# compose.prod.yaml is the single knob that sizes the heap.
#
# ExitOnOutOfMemoryError: a heap-exhausted JVM that keeps running serves errors indefinitely. Exiting
# lets compose's `restart: unless-stopped` recycle it, and the in-memory pool restores from its
# checkpoint on startup.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70.0", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
