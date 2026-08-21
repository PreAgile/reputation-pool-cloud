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

# JDK 가 아니라 JRE 를 쓰면 `jcmd`·`jmap`·`jstack` 이 없다 — 이미지에 `java jfr jrunscript
# jwebserver keytool rmiregistry` 만 들어온다. 그러면 NMT 를 켜도 읽을 수 없고, 힙 덤프도 스레드 덤프도
# 뜰 수 없다. 즉 힙 밖에서 죽는 사고(cgroup OOM-kill)를 **원리적으로 진단할 수 없는** 이미지가 된다.
#
# 사고가 난 뒤에 도구를 설치하는 것은 답이 아니다. 2 OCPU 호스트에서 라이브 인시던트 중에 패키지를
# 설치하는 것은 최악의 타이밍이고, 그 사이 compose 의 `restart: unless-stopped` 가 컨테이너를 이미
# 재생성해 증거가 사라진다. 도구는 사고 전에 들어 있어야 한다.
#
# 비용은 이미지 약 180MB 증가다. 서버는 GHCR 에서 pull 만 하고(레이어는 증분), 부트 볼륨은 48GB 중
# 37GB 가 남아 있으므로 이 호스트에서 문제가 되지 않는다. 진단 도구 부재는 사고마다 반복해서 내는
# 비용이고 이미지 크기는 한 번 내는 비용이다.
FROM eclipse-temurin:25-jdk AS run
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
