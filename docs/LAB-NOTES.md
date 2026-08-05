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
| Cluster | GKE Standard, zonal (`us-central1-a`), 2 × `e2-standard-2` |
| Cluster networking | **Private nodes** + Cloud NAT for egress; public control plane endpoint restricted by authorized networks (see Findings 1 and 3) |
| Kubernetes version | v1.35.6-gke.1250000 |
| Registry | Docker Hub, public repository |
| Build infra | Harness Cloud (hosted) |
| Deploy target | `dev` namespace, in-cluster Harness Delegate |
| App | Spring Boot 3.3.5 on Java 21, built with Maven |

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

### Cost control — parking the cluster between sessions

A lab spread over several days should not bill continuously. GKE has no pause, so
`scripts/lab-down.sh` scales the node pool to zero — which deletes the node VMs **and**
their boot disks — and removes the Cloud NAT gateway, which bills hourly whether or not
anything routes through it. Measured at list prices, that is roughly 97% of the hourly
cost. The cluster object itself survives, so namespaces, the installed delegate, and every
Harness-side connector and pipeline remain valid; resuming is about two minutes rather
than a rebuild.

`scripts/lab-up.sh` reverses it, and **order matters**: NAT is recreated *before* nodes
scale up. Reversed, nodes boot with no egress and the delegate comes up unable to reach
Harness — which presents as a Harness fault rather than a networking one, the same trap as
Finding 1.

### Finding 6 — `gcloud ... resize` reports failure while succeeding

The first real `lab-up.sh` run aborted partway through:

```
ERROR: (gcloud.container.clusters.resize) Operation [...] is still running,
check its status via 'gcloud container operations describe ...'
```

`gcloud container clusters resize` blocks on a **client-side** wait that gives up well
before GKE finishes, then exits non-zero — while the operation continues `RUNNING`
server-side. Nothing had actually failed. But under `set -e` the non-zero exit killed the
rest of the script, so the kubeconfig was never refreshed and the control-plane allow-list
was never updated. The result was a cluster coming up perfectly normally and unreachable
from this machine, for reasons unrelated to the cluster.

Fixed by dispatching with `--async` and polling `gcloud container operations describe`
until `DONE`, treating **operation status as the source of truth rather than the client's
patience**.

This is the same class of error as Finding 5: trusting an exit code instead of the
observable state. Twice in one lab, in opposite directions — once a failure reported as
success, once a success reported as failure. The general lesson is that for asynchronous
cloud operations the CLI's exit code describes *the CLI's experience*, not the operation's
outcome, and any automation that treats the two as equivalent will eventually be wrong.

### Finding 7 — scaling to zero can strand you: `ZONE_RESOURCE_POOL_EXHAUSTED`

Parking the cluster worked. **Un-parking it did not.**

```
ZONE_RESOURCE_POOL_EXHAUSTED
Instance 'gke-harness-lab-default-pool-...' creation failed: the zone
'us-central1-a' does not have enough resources available to fulfill the request.
```

GKE retried every few minutes for roughly twenty minutes and failed every time. The
cluster and its configuration were fine; the zone had simply run out of `e2-standard-2`.

**Diagnosis.** The cluster sat in `RECONCILING` with no instances, which says nothing on
its own. The managed instance group was the useful signal — target size 2, actual size 0,
`isStable: false` — and `gcloud compute instance-groups managed list-errors` gave the
actual reason. Worth remembering: *when GKE nodes do not appear, the MIG holds the error,
not the cluster.*

**Attempted fix that also failed.** A different machine family draws from a different
capacity pool, so I created an `n2-standard-2` pool in the same zone. It hit the identical
error 14 times — the zone was broadly constrained, not short of one machine type.

**Actual fix.** A zonal cluster cannot span zones, so the node pool could not be moved.
Rebuilt the cluster in **us-central1-c**, where capacity existed. This was cheap precisely
because the cluster held nothing yet — no delegate, no workloads, three namespaces.
Cloud NAT is *regional*, so it covered the new zone with no change.

**The lesson, which is the important part.** Scaling to zero to save money **releases your
claim on capacity, and that capacity is not reserved for you.** Coming back means
re-requesting from a shared pool that may have none. The cost saving is real and so is the
risk; it was a mistake not to state that tradeoff when adopting the strategy rather than
after discovering it.

For a lab this is an inconvenience. For a customer running scale-to-zero on non-production
environments, it is a genuine availability consideration, and there are real mitigations:

| Mitigation | Trade-off |
|---|---|
| **Regional cluster / multi-zone node pool** | Survives a single-zone stockout — the strongest fix. Costs nodes per zone |
| **Reservations** | Guarantees capacity; you pay for it whether or not it is used |
| **Keep a minimum node count above zero** | Retains a foothold, but does not reserve capacity for scale-up |
| **Accept and automate retry across zones** | Free; only viable where downtime is tolerable |

For this lab the right answer is "accept it and rebuild elsewhere," which is what happened.
For anything with an availability requirement it would be a regional cluster.

**A self-inflicted complication during the rebuild.** The first replacement cluster came up
`ERROR`:

```
Conflicting IP cidr range: Invalid IPCidrRange: 172.16.0.0/28 conflicts with
existing subnetwork 'gke-harness-lab-...-pe-subnet' in region 'us-central1'.
```

I had reused `--master-ipv4-cidr=172.16.0.0/28` from the original command. A private
cluster's control-plane range is backed by a **regional** private-endpoint subnet, so while
the old cluster still existed in `us-central1-a`, a new cluster anywhere in `us-central1`
could not claim the same range. Rebuilt with `172.16.16.0/28`.

The general point: a private cluster's master CIDR is a **regional** allocation, not a
zonal one. Any runbook that recreates private clusters needs to either allocate a distinct
range or confirm the predecessor is fully deleted first — and "fully deleted" is doing real
work in that sentence, because a cluster stuck in `RECONCILING` still holds its subnet.

**Two smaller notes.** Deleting the old cluster initially failed with `Cluster is running
incompatible operation` — the failed resize still held a lock, and GKE serializes cluster
operations, so the delete only succeeded once that operation finally gave up. And because
cluster names are unique *per zone*, the replacement in `us-central1-c` could be created
while the broken one still existed in `us-central1-a`, which made the rebuild non-blocking.

**References.**
- Org policy constraints: https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints
- Master authorized networks: https://cloud.google.com/kubernetes-engine/docs/how-to/authorized-networks
- Resizing a cluster: https://cloud.google.com/kubernetes-engine/docs/how-to/resizing-a-cluster
- Resource availability / stockouts: https://cloud.google.com/compute/docs/troubleshooting/troubleshooting-vm-creation
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

### Decision record — why a separate registry exists at all

Worth stating plainly, because it is the architectural seam of the whole exercise:
**Kubernetes cannot run source code.** It runs images, and it obtains them by pulling from
a registry — a Deployment's `image:` field is a registry pointer, and there is no mode
where you hand Kubernetes a Git URL. So a registry is not an optional convenience between
build and deploy; it is the mechanism by which deployment happens at all.

Three consequences:

- **The build host is ephemeral.** Harness Cloud runners are destroyed when the build ends.
  An image existing only on the runner's local daemon evaporates minutes later.
- **The cluster cannot reach the build host.** Nodes pull images themselves, on their own
  initiative. They need a durable, authenticated, network-reachable address.
- **It is the CI/CD boundary.** CI's job ends at "produce an artifact"; CD's begins at
  "consume an artifact." That decoupling is exactly why the two stages can run on different
  infrastructure — CI on Harness Cloud, CD through the delegate — and still compose.

This is also why images are tagged `<+pipeline.sequenceId>` rather than `latest`: an
immutable tag means "what is running in prod" has an exact answer and rollback is simply
redeploying the previous tag. `latest` destroys both properties.

### Decision record — Docker Hub over Artifact Registry or Artifactory

The instinct to consolidate on an existing registry is correct **in production** — one auth
model, one RBAC surface, existing retention and vulnerability scanning, no additional
vendor. Harness has first-class connectors for Artifactory and for any standard registry,
so there is no integration penalty. See §6.

For this lab three constraints pointed the other way:

1. **The brief requires a *public* registry**, and a grader who cannot pull the image cannot
   verify the artifact half of the exercise. A private registry would also require an
   `imagePullSecret`, adding configuration that exists only to work around a self-inflicted
   constraint.
2. **Credentials.** Wiring an organization's production registry would mean placing its
   credentials into a **free-trial SaaS tenant** created for a homework exercise. That is
   the wrong place for production artifact-store credentials regardless of how short-lived
   the exercise is.
3. **Isolation.** The lab deliberately runs in a throwaway project. Routing artifacts
   through a production registry re-couples them and leaves lab images behind after
   teardown.

### Finding 4 — org policy also rules out a public Artifact Registry

Google Artifact Registry would otherwise have been the natural choice here: same cloud, no
extra account. It is not usable as a *public* registry under this organization's policy:

```
$ gcloud resource-manager org-policies describe constraints/iam.allowedPolicyMemberDomains \
    --project=<GCP_PROJECT_ID> --effective
listPolicy:
  allowedValues:
  - <CUSTOMER_ID>          # domain-restricted sharing
```

Making an Artifact Registry repository publicly pullable requires granting the
`artifactregistry.reader` role to `allUsers`. Domain-restricted sharing blocks precisely
that grant, and `storage.publicAccessPrevention` is enforced as well. The policy is
correct — it is what stops accidental public exposure of internal artifacts — but it means
"public registry" and "this GCP organization" are mutually exclusive by design.

This is the third org-level policy to shape the architecture, after the external-IP denial
in §1. A recurring lesson: **check effective org policy before choosing an approach, not
after the error message.**

### Finding 5 — registry token scopes, and a verification script that lied

Before wiring any Harness connector, I tested the registry directly: push with credentials,
then pull *without* them. The push failed:

```
authentication required - access token has insufficient scopes
```

**Distinguishing the two candidate causes.** "Insufficient scopes" could mean the repository
was private, or the token lacked write permission. These have completely different fixes, so
I checked both independently rather than guessing:

```
# Is the repo private?  -> No.
$ curl -s https://hub.docker.com/v2/repositories/<REGISTRY_USER>/harness-lab-app/
  is_private : False

# Will the auth service issue a push-scoped token?  -> No.
$ curl -H "Authorization: Basic <creds>" \
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository:<...>:pull,push"
  HTTP 401 Unauthorized
```

Public repo, refused push token — so unambiguously a token-scope problem. Docker Hub's
newer PAT UI both defaults to read-only and allows scoping a token to specific
repositories, so a token generated before the repository exists will not cover it even at
the right permission level. Regenerating with **Read & Write** resolved it.

**Verified after the fix**, using an anonymous token — the same path a cluster node takes,
with no credentials at all:

```
$ curl -H "Authorization: Bearer <anonymous-token>" \
    https://registry-1.docker.io/v2/<REGISTRY_USER>/harness-lab-app/manifests/registry-smoke
  HTTP 200            # publicly pullable -> no imagePullSecret required
  arch: ['amd64']     # matches the GKE nodes
```

**Why pre-check at all.** Wiring Harness first would have surfaced this as a failed CI stage
several minutes into a pipeline run, with a registry error that reads like a Harness
misconfiguration. Testing the dependency directly cost about a minute and pointed at exactly
one setting. Same principle as the egress pre-check in §1: **verify each external dependency
in isolation before composing them**, because a failure inside an orchestrator is always
harder to attribute than the same failure standing alone.

**The more uncomfortable lesson.** My verification script reported success on a push that had
actually failed — twice, for two different reasons:

1. `docker push -q ... | tail -3` — the pipe returned `tail`'s exit status, so the failure
   was invisible and `set -e` never fired.
2. The rewrite used `${PIPESTATUS[0]}`, which is a **bash** array. This shell is **zsh**,
   where it is `pipestatus`; the variable expanded empty and the guard evaluated on an empty
   string.

Both times the script printed a confident checkmark over a failed operation. The push was
only caught because the raw output was also visible.

A verification that cannot fail is worse than no verification, because it manufactures
false confidence. Two rules taken from this: **assert on the artifact, not on the exit
code** — the anonymous `HTTP 200` is trustworthy in a way `$?` was not — and **negative-test
the check itself**, exactly as `scripts/validate-manifests.sh` was negative-tested by
inducing a typo. That validator is trustworthy because it has been observed to fail; these
push checks had not been, and it showed.

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

**Consolidate on the existing artifact registry.** The strongest single change. An
organization already running Artifactory (or Artifact Registry, or ECR) should not add a
second registry to adopt a CD tool. One registry means one authentication model, one RBAC
surface, existing retention and vulnerability-scanning policy applied uniformly, one place
to audit, and no additional vendor relationship. Harness connects to Artifactory natively,
both as an artifact source and as a CI publish target, so this costs nothing in
integration effort — it is a connector swap and an image path, with nothing downstream
depending on the choice.

The lab uses Docker Hub only because the exercise requires a publicly pullable image and
because production credentials do not belong in a trial tenant (§3). Those are properties
of the exercise, not of the architecture.

**Narrow the delegate's RBAC.** The generated delegate manifest binds its ServiceAccount to
`cluster-admin`, which is convenient and far broader than deployment requires. In
production this should be a scoped Role bound to the namespaces the delegate actually
deploys into, and ideally one delegate per environment so a dev-scoped delegate holds no
credentials that reach prod.

**Separate cluster lifecycle from application delivery.** Provisioning belongs to a
platform team's Terraform (or Harness IaCM), not to the pipeline that ships the app.
Beyond being the conventional split, it avoids a Terraform step destroying the cluster
hosting the delegate executing it.

**Add governance gates.** OPA policy-as-code on the pipeline (enforcing, for example, that
prod deployments cannot use `latest`, or that an approval step exists before any prod
stage), plus notifications wired to the team's channel rather than living only in the
Harness UI.

**Replace manual approval with automated verification** where the signal exists — Harness
continuous verification against metrics, so promotion is gated on observed health rather
than a human deciding the canary looks fine.

**Open questions.**
- Does the Harness free trial include IaCM? If so, cluster provisioning could be
  demonstrated end to end rather than described.
- Harness Code Repository and Harness Artifact Registry could collapse this three-vendor
  stack to one. Worth evaluating for a greenfield customer; not worth an SCM migration for
  an established one.

---

## 7. Teardown

Cloud resources deleted after evidence capture; tokens issued for the lab revoked.

| Resource | Deleted |
|---|---|
| Kubernetes cluster | ⬜ |
| Registry access token | ⬜ |
| GitHub PAT | ⬜ |
