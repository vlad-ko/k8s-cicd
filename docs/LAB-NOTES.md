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
| 1 | Kubernetes cluster set up | ✅ |
| 2 | Harness trial & delegate install | 🟡 |
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

**Approach & rationale.** GKE, over Minikube or kind, for three reasons: the tooling was
already authenticated locally; a managed control plane removes a whole class of
distractions that are not what this lab is testing; and — the deciding factor — a GKE
`Service` of `type: LoadBalancer` gets a real external IP, so the CD exercise can be
verified with an ordinary HTTP request rather than a `kubectl port-forward`. The evidence
is a URL, not a localhost tunnel.

Zonal rather than regional: one control plane is cheaper and a lab has no availability
requirement. A dedicated throwaway project isolates the lab from anything else and makes
teardown a single delete.

### Finding 1 — an inherited org policy forbids external IPs on VMs

Before creating anything, I checked the effective org policies on the new project. This
turned out to matter:

```
$ gcloud resource-manager org-policies describe compute.vmExternalIpAccess \
    --project=<GCP_PROJECT_ID> --effective
  DENY
```

The constraint is set at the **organization** level and inherited by every project in it,
including a brand-new one. It forbids external IP addresses on Compute Engine VM
instances — and GKE nodes are VMs.

**Why this matters more than it first appears.** A default ("public") GKE cluster gives
its nodes external IPs, which is also how those nodes reach the internet. Under this
policy that is not available, so nodes have **no outbound internet path at all**. The
downstream consequence is the one the delegate depends on: the Harness delegate is an
outbound-only agent that must establish a connection to `app.harness.io`. With no egress,
the delegate manifest applies cleanly, the pod reports `Running`, and it simply never
connects — a failure that looks like a Harness problem while being a networking one.

I had pre-identified "delegate installs but never connects" as a likely failure mode of
choosing a *private* cluster. It arrived anyway, through a policy I did not choose.
Checking effective org policy before provisioning turned a confusing multi-hour debug into
a five-minute design decision.

**Resolution — Cloud NAT, not a policy exemption.** Two options existed:

1. Override the org policy for this project. **Rejected.** It is an organization-wide
   security control, and weakening it to make a lab convenient is the wrong trade
   regardless of whether I hold the permission to do it.
2. Accept private nodes and give them egress through **Cloud NAT**. Chosen — it is
   policy-compliant, needs no elevated permission, and is closer to how a production
   cluster is actually built.

So the constraint pushed the design toward the better answer.

```
# Egress path for nodes that cannot hold external IPs
gcloud compute routers create harness-lab-router \
  --network=default --region=us-central1
gcloud compute routers nats create harness-lab-nat \
  --router=harness-lab-router --region=us-central1 \
  --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges

# Private nodes; control plane endpoint left public so kubectl works from a laptop
gcloud container clusters create harness-lab \
  --zone=us-central1-a --num-nodes=2 --machine-type=e2-standard-2 \
  --release-channel=regular \
  --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28
```

**Does this break the LoadBalancer Service?** No — and the distinction is worth being
precise about. `compute.vmExternalIpAccess` governs external IPs attached to *VM
instances*. A `type: LoadBalancer` Service provisions a forwarding rule with its own
external IP, which is a different resource and is not covered by the constraint. Nodes
stay private; the load balancer is still publicly reachable. (Verified at Gate G6 below.)

### Finding 2 — `gke-gcloud-auth-plugin` is required and not installed by default

`kubectl` cannot authenticate to GKE without it, and the failure surfaces only at the
first `kubectl` call. `gcloud components install gke-gcloud-auth-plugin` fetched it, but
because gcloud was installed through Homebrew, the binary landed inside the Caskroom
without being symlinked onto `PATH` — so it was installed and still not found. Needed an
explicit symlink into `/opt/homebrew/bin/`.

### Finding 3 — `--enable-private-nodes` silently locks out `kubectl`

The cluster reached `RUNNING`, `get-credentials` succeeded, and then every `kubectl` call
hung for 32s and failed:

```
E0805 11:11:01 "couldn't get current server API group list:
  Get "https://<CONTROL_PLANE_IP>/api?timeout=32s": dial tcp <CONTROL_PLANE_IP>:443: i/o timeout"
```

`i/o timeout` rather than a TLS or authentication error is the tell: the packets were not
being refused, they were going nowhere. That points at network reachability, not
credentials — so I inspected the cluster's endpoint configuration rather than debugging
auth:

```
$ gcloud container clusters describe harness-lab --format='yaml(masterAuthorizedNetworksConfig)'
masterAuthorizedNetworksConfig:
  enabled: true          # ← enabled, with NO cidrBlocks list
```

**Root cause.** Passing `--enable-private-nodes` caused GKE to enable *master authorized
networks* automatically, and the resulting allow-list was **empty**. The public endpoint
existed and was advertised, but no source address on the internet was permitted to reach
it. I never asked for this; it is an implicit consequence of the private-nodes flag.

The fix is to authorize the client explicitly:

```
gcloud container clusters update harness-lab --zone=us-central1-a \
  --enable-master-authorized-networks \
  --master-authorized-networks="<MY_PUBLIC_IPV4>/32"
```

A wrinkle worth recording: the obvious way to find that address (`curl ifconfig.me`)
returned an **IPv6** address on this network, and GKE's authorized-networks field accepts
IPv4 CIDR only, rejecting it with a regex error. `curl -4` forces the IPv4 answer.

**Operational note.** This allow-list is pinned to one residential IP, which will change.
It gates only `kubectl` from this laptop — **not** the Harness delegate, which runs inside
the cluster and reaches the control plane over its private endpoint. Deployments are
therefore unaffected by this restriction, which is a good illustration of why the delegate
model exists at all.

### Pre-verifying egress before installing anything

Rather than install the delegate and hope, I tested the exact network path it depends on
with a throwaway pod:

```
$ kubectl run egress-test --rm -it --image=curlimages/curl -- \
    curl -s -o /dev/null -w "%{http_code}" https://app.harness.io/
HTTP 401 in 0.106218s
```

**A 401 here is a pass, not a failure.** It proves TCP and TLS completed and a real
application response came back; the 401 is merely the expected "unauthenticated." Had
Cloud NAT been misconfigured, this would have been a timeout with no status code at all.
The same check against `registry-1.docker.io` also returned 401, confirming the image-pull
path works too.

This is the check that converts Finding 1 from a hypothesis into a verified fact, and it
cost about fifteen seconds.

**Gate G1 — `kubectl get nodes`** ✅
```
NAME                                         STATUS   ROLES    AGE   VERSION
gke-harness-lab-default-pool-6612f4b0-737h   Ready    <none>   3m49s v1.35.6-gke.1250000
gke-harness-lab-default-pool-6612f4b0-mt84   Ready    <none>   3m47s v1.35.6-gke.1250000
```

Node external IPs confirmed empty, i.e. the org policy is satisfied rather than
circumvented:
```
gke-harness-lab-default-pool-6612f4b0-737h  externalIP=
gke-harness-lab-default-pool-6612f4b0-mt84  externalIP=
```

Namespaces `dev` and `harness-delegate-ng` created.

**Screenshot:** `screenshots/01-cluster-nodes.png`

**References.**
- Org policy constraints: https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints
- Master authorized networks: https://cloud.google.com/kubernetes-engine/docs/how-to/authorized-networks
- GKE private clusters: https://cloud.google.com/kubernetes-engine/docs/how-to/private-clusters
- Cloud NAT: https://cloud.google.com/nat/docs/overview
- kubectl auth plugin: https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl

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
