package io.harnesslab.app;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * These tests exist so the CI stage has something real to run and to fail on. They assert
 * specific values rather than mere 200s — a test that only checks the status code would
 * still pass if the version field were dropped entirely, which is the exact regression
 * that would invalidate the deployment evidence.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {"app.version=9.9.9-test", "app.build=test-build"})
class VersionControllerTest {

    @Autowired private MockMvc mockMvc;

    @Test
    @DisplayName("root endpoint reports the configured version and build")
    void reportsVersionAndBuild() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.application").value("harness-lab-app"))
                .andExpect(jsonPath("$.version").value("9.9.9-test"))
                .andExpect(jsonPath("$.build").value("test-build"));
    }

    @Test
    @DisplayName("root endpoint always identifies the serving instance")
    void reportsInstance() throws Exception {
        // Non-empty rather than a fixed value: the hostname differs per pod, which is
        // the point of the field. Asserting it is merely present would let a null or
        // blank slip through and silently break the rolling-deploy demonstration.
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.instance").isNotEmpty());
    }

    @Test
    @DisplayName("readiness probe endpoint is exposed for Kubernetes")
    void readinessProbeIsExposed() throws Exception {
        // The Deployment's readinessProbe targets this path. If actuator config drifts,
        // pods would never become Ready and the deploy would stall — fail here instead.
        mockMvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
    }
}
