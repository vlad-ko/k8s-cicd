# Harness Implementation Engineering Lab — Notes

The lab brief asks for "screenshots, notes, and any relevant links in a separate document
for later review." This is that document.

It is written **as the work happens**, not reconstructed afterwards. Where something
broke, the symptom, the hypothesis, the check, and the fix are all recorded — the brief
states outright that diagnosing "why things don't quite work as expected" is the point of
the exercise, so failures are treated as findings rather than as noise.

> **Redaction note.** Account identifiers, cluster endpoints, and credentials are replaced
> with placeholders throughout, and screenshots are cropped accordingly.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ verified · ❌ blocked

| # | Exercise | Status |
|---|---|---|
| 1 | Kubernetes cluster set up | ⬜ |
| 2 | Harness trial & delegate install | ⬜ |
| 3 | Harness CI | ⬜ |
| 4 | Harness CD | ⬜ |
| 5 | Bonus — templates | ⬜ |

---

## 0. Environment

| Component | Version / detail |
|---|---|
| Host OS | macOS (Darwin 25.4.0) |
| kubectl | v1.34.1 |
| Docker | 29.4.0 (Docker Desktop) |
| Cluster | GKE — Standard, zonal, public |
| Registry | Docker Hub, public repository |
| Build infra | Harness Cloud (hosted) |
| Deploy target | `dev` namespace, in-cluster Harness Delegate |

---

## 1. Kubernetes cluster set up

**Goal.** A reachable Kubernetes cluster to host the delegate and receive deployments.

**Approach & rationale.**
<!-- Why GKE over Minikube/kind. Why zonal over regional. Why public over private. -->

**Commands.**
```
<!-- redacted, parameterized commands -->
```

**Gate G1 — `kubectl get nodes`**
```
<!-- paste real output -->
```

**Screenshot:** `screenshots/01-cluster-nodes.png`

**What broke / what I learned.**
<!-- If nothing broke, say so explicitly — an empty section reads as an omission. -->

**References.**
<!-- doc URLs actually used -->

---

## 2. Harness trial & delegate install

**Goal.** A delegate running in-cluster and connected to the Harness control plane.

**Approach & rationale.**
<!-- Delegate install method chosen (YAML vs Helm) and why. What the manifest creates:
     namespace, ServiceAccount, ClusterRoleBinding — and why the K8s connector later
     depends on that ServiceAccount. -->

**Gate G2 — delegate pod + Harness UI status**
```
<!-- kubectl get pods -n harness-delegate-ng -->
```

**Screenshot:** `screenshots/02-delegate-connected.png` *(crop the account ID out of the URL bar)*

**What broke / what I learned.**
<!-- Prime candidates: pod Pending on insufficient resources; installs but never connects
     (egress); CrashLoopBackOff on a bad token. Record the diagnosis path, not just the fix. -->

**References.**

---

## 3. Harness CI

**Goal.** Build the application from source and publish a tagged image to a public registry.

**Connectors configured.**

| Connector | Auth method | Test Connection |
|---|---|---|
| GitHub | PAT (Harness secret) | ⬜ |
| Docker Hub | access token (Harness secret) | ⬜ |
| Kubernetes | delegate credentials | ⬜ |

**Pipeline — Build stage.**
<!-- Infrastructure: Harness Cloud. Steps: Run (mvn) → Build and Push. -->

**On tagging.** Images are tagged `<+pipeline.sequenceId>` rather than `latest`.
<!-- Explain the CI→CD seam: the CD stage resolves the same expression, so the two stages
     line up without brittle cross-stage step-output references. -->

**Why no delegate is involved here.**
<!-- CI runs on Harness-hosted runners; contrast with CD in §4. -->

**Gate G4 — pipeline green + image in registry**

**Screenshots:** `screenshots/03-ci-pipeline-green.png`, `screenshots/03-dockerhub-tag.png`

**What broke / what I learned.**

**References.**

---

## 4. Harness CD

**Goal.** Deploy the CI-produced image to Kubernetes using manifests.

**Harness objects created.**

| Object | Value |
|---|---|
| Service | type Kubernetes; manifests from `k8s/`; values `k8s/values.yaml` |
| Artifact | Docker Registry → image, tag `<+pipeline.sequenceId>` |
| Environment | `dev` (PreProduction) |
| Infrastructure | Kubernetes Direct → namespace `dev` |
| Strategy | Rolling |

**Why the delegate is required here but not in §3.**
<!-- The API server is not addressable from Harness; the delegate is the outbound-only
     agent that closes the gap. -->

**Gate G5 — pods running** · **Gate G6 — reachable over HTTP**
```
<!-- kubectl get pods -n dev ; kubectl get svc -n dev ; curl http://<EXTERNAL-IP> -->
```

**Gate G7 — the full loop.** Version bumped, pushed, pipeline re-run, new version served
from the same external IP.

| | Before | After |
|---|---|---|
| Version | | |
| Image tag | | |

**Screenshots:** `screenshots/04-cd-stage-green.png`, `screenshots/04-app-live.png`

**What broke / what I learned.**

**References.**

---

## 5. Bonus — templates

**Goal.** Templatize a pipeline step and reference it from the pipeline.

**What was templatized and why.**
<!-- Which step, at which scope, which fields left as runtime inputs — and why those. -->

**Reuse demonstrated.**
<!-- Publishing v2 and the version-pinning vs "always use stable" behaviour. This is the
     governance story, which is the actual value proposition — not just the mechanic. -->

**Gate G8 — pipeline references the template**

**Screenshots:** `screenshots/05-template-library.png`, `screenshots/05-pipeline-linked.png`

**What broke / what I learned.**

**References.**

---

## 6. Retrospective

**What surprised me.**

**What I'd do differently in production.**
<!-- Narrower RBAC than cluster-admin on the delegate ServiceAccount; private registry;
     canary or blue-green over rolling; policy-as-code gates; GitOps; multi-environment
     promotion with approvals; pipeline-as-code in Git. -->

**Open questions.**

---

## 7. Teardown

Cloud resources deleted after evidence capture; tokens issued for the lab revoked.

| Resource | Deleted |
|---|---|
| Kubernetes cluster | ⬜ |
| Registry access token | ⬜ |
| GitHub PAT | ⬜ |
