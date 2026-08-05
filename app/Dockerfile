# ---------- build stage ----------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies resolve in their own layer, keyed on the POM alone. Source edits
# then reuse the cached layer instead of re-downloading the world every push.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B clean package

# ---------- runtime stage ----------
# JRE, not JDK: the compiler and build tooling have no reason to ship to production,
# and leaving them out cuts both image size and attack surface.
FROM eclipse-temurin:21-jre-alpine

# Run unprivileged. Nothing here needs root, and a container that cannot write to
# its own filesystem as root is materially harder to pivot from.
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=build /build/target/harness-lab-app-*.jar app.jar
USER app

EXPOSE 8080

# Exec form, so the JVM is PID 1 and receives SIGTERM directly from Kubernetes.
# Wrapped in a shell it would not, and graceful shutdown would never run —
# rolling deploys would drop in-flight requests.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
