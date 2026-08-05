package io.harnesslab.app;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The single endpoint this lab needs.
 *
 * <p>Each field exists to make a specific claim verifiable from a browser rather than
 * by assertion:
 *
 * <ul>
 *   <li>{@code version} — sourced from the POM at build time. Bumping the POM version and
 *       re-running the pipeline changes what this returns, which is how the CI to CD loop
 *       is demonstrated end to end.
 *   <li>{@code build} — the Harness pipeline run that produced the running image. Proves
 *       the deployed artifact came from the expected pipeline execution, not a stale tag.
 *   <li>{@code instance} — the pod hostname. With multiple replicas behind the Service,
 *       refreshing shows traffic spread across pods, and during a rolling deploy shows
 *       old and new pods serving simultaneously.
 * </ul>
 */
@RestController
public class VersionController {

    private final String version;
    private final String build;

    VersionController(
            @Value("${app.version}") String version, @Value("${app.build}") String build) {
        this.version = version;
        this.build = build;
    }

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of(
                "application", "harness-lab-app",
                "version", version,
                "build", build,
                "instance", instanceName());
    }

    /**
     * Kubernetes sets the pod name as the container hostname. Falling back to the HOSTNAME
     * environment variable covers local runs where the lookup is unavailable.
     */
    private String instanceName() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (java.net.UnknownHostException e) {
            String hostname = System.getenv("HOSTNAME");
            return hostname != null ? hostname : "unknown";
        }
    }
}
