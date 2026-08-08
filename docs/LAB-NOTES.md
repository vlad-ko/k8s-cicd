# Harness Implementation Engineering Lab — Notes

The lab brief asks for "screenshots, notes, and any relevant links in a separate document
for later review." This is that document.

**What this lab actually does:** it takes a game I built and deployed to Vercel, containerizes
it, and redeploys it to GKE — rebuilding Vercel's multi-stage deploy explicitly with Harness
CI/CD, and templatizing it so the pipeline is reusable rather than bespoke.

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
| 2 | Harness trial & delegate install | ✅ |
| 3 | Harness CI | ✅ |
| 4 | Harness CD | ✅ |
| 5 | Bonus — templates | ✅ |

---

## 0. Environment

| Component | Version / detail |
|---|---|
| Host OS | macOS (Darwin 25.4.0) |
| kubectl | v1.34.1 |
| Docker | 29.4.0 (Docker Desktop) |
| Cluster | **GKE Autopilot**, regional (`us-central1`) — adopted after repeated zone capacity stockouts on Standard (Finding 7) |
| Cluster networking | **Private nodes** + regional Cloud NAT for egress; control plane not restricted by authorized networks |
| Kubernetes version | v1.35.6-gke.1250000 |
| Registry | Docker Hub, public repository |
| Build infra | **Self-hosted Kubernetes** (`KubernetesDirect`, namespace `harness-build`, on the same cluster) — Harness Cloud was the plan until it turned out to require credit-card validation (Finding 16) |
| Deploy target | `dev` and `prod` namespaces, via an in-cluster Harness Delegate |
| Delegate | `webo-moneyworld`, Helm chart, version 26.07.89703 |
| App | [Webo's Money World](https://github.com/wealthbot-io/webo-money-world) — static frontend + two Vercel serverless functions, containerized on Node 22 |

---

## The application — from Vercel to Kubernetes

**Goal.** Replace the throwaway sample the tutorial suggests with a real application, and in
doing so make the exercise about *portability* rather than about following a guide.

The app is [Webo's Money World](https://github.com/wealthbot-io/webo-money-world), a kids'
financial-literacy game: a static Alpine.js frontend with no build step, plus two Vercel
serverless functions (`api/ask.js`, `api/progress.js`) and security headers declared in
`vercel.json`. It runs on Vercel today. This lab runs the same source on Kubernetes.

The brief says "Java (or other language of choice)", so nothing here conflicts with it. The
original plan used Java and Maven purely because the linked quickstart does; that argument
was weak, and swapping before any pipeline existed cost only a Dockerfile.

### Why this framing is the interesting part

Vercel provides a great deal **implicitly**. None of it survives the move to Kubernetes, and
rebuilding each piece turns an invisible platform guarantee into an explicit, inspectable
stage:

| Vercel gives you implicitly | Rebuilt here as |
|---|---|
| Build on push | Harness CI, triggered by a GitHub webhook on `main` |
| Immutable deployment per commit | Image tagged `<+pipeline.sequenceId>` |
| Preview → Production promotion | `dev` → Harness approval gate → `prod` |
| Zero-downtime rollout | `K8sRollingDeploy` with `maxUnavailable: 0` |
| Automatic HTTPS on a real hostname | ingress-nginx + cert-manager + Let's Encrypt |
| Headers from `vercel.json` | Reapplied in the container server |
| Instant rollback | `K8sRollingRollback`, automatic on stage failure |
| Env vars in the dashboard | Harness secret manager → Kubernetes Secret |

Knowing what a platform does *for* you, and being able to rebuild it when a customer cannot
use that platform, is the job. The templates are what stop it from being a one-off.

### The constraint that makes the claim real

**`api/ask.js` and `api/progress.js` are not modified.** The same source still runs on
Vercel; only the thing invoking them changed. Editing the handlers to suit Kubernetes would
have made the portability claim circular — of course it runs, it was rewritten to.

So `server.js` reconstructs the three things Vercel's platform supplied:

1. **Static file serving**, over an explicit allowlist
2. **The handler surface** — Vercel's Node runtime injects `req.body`, `req.query`,
   `res.status()` and `res.json()`; Node's `http` provides none of them
3. **The `vercel.json` headers**, reapplied on every response

All **40 of the app's own tests pass unmodified**.

### Choices worth defending

**An allowlist, not a document root.** The app root also contains `api/`, server-side `lib/`,
`test/` and `.env.example`. Serving the directory with a path-traversal guard would still
happily serve `lib/kv.js`. Enumerating what is public is the safer default — `lib/` is mixed,
with `lesson-kit.mjs` a browser module and `kv.js`/`util.js` server-side, and only the former
is exposed.

**`/api/version` is a test affordance, not a feature.** It returns `version` (from
`package.json`), `build` (the Harness pipeline run) and `instance` (the pod name). Those three
fields are what make "did the redeploy actually work?" and "which pods are serving right now?"
answerable by screenshot rather than by assertion. Gate G7 depends on them, and `instance` is
what would have made canary and stable pods distinguishable had G10 been kept (descoped, #3).

**Health endpoints answer before security headers and application logic**, so a fault in the
app cannot make a healthy pod look unhealthy and trigger a restart loop.

**`ANTHROPIC_API_KEY` uses `optional: true`.** A missing secret degrades Ask Webo to its
warming-up response rather than blocking the pod from starting. It also gives the lab a real
secret to flow through the Harness secret manager into a Kubernetes Secret — a capability
nothing else here exercises.

**Resource requests state Autopilot's real minimums.** Autopilot silently rounds smaller
requests up, so asking for `100m` CPU and seeing `250m` on the running pod reads as
configuration drift. Naming the actual floor keeps the manifest honest.

**Verified before any pipeline work:** 40/40 tests, image builds for `linux/amd64` (237 MB),
container healthy, `BUILD_ID` surfaced through to `/api/version`, runs as uid 1000, SIGTERM
drains, all five `vercel.json` headers present, server-side files return 404, path traversal
blocked.

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

### Decision — switching to GKE Autopilot

After `us-central1-a` and `us-central1-c` both returned
`ZONE_RESOURCE_POOL_EXHAUSTED`, continuing to hunt for a zone with spare
`e2-standard-2` capacity was solving the wrong problem. The cluster was moved to
**GKE Autopilot**.

The reasoning is worth stating precisely, because it is not "Autopilot has more
capacity":

- **The failure mode disappears rather than moves.** Standard requires *you* to hold node
  capacity, so scaling to zero surrenders it and returning means competing for VMs that
  may not exist. Autopilot provisions against pod requests from a managed pool, so parking
  is "no pods" rather than "no nodes," and there is no node-pool capacity to reclaim.
- **It removes work that this lab is not about.** The exercise is a Harness CI/CD
  implementation; node pools, machine types, and zone selection are incidental. Every hour
  spent on them is an hour not spent on the thing being assessed.
- **The billing model suits an intermittent lab.** Charges follow pod resource requests
  rather than always-on nodes.

**Costs of the switch**, recorded honestly: Autopilot enforces minimum resource requests,
so the `100m` CPU requests in `k8s/values.yaml` are rounded up to Autopilot's floor — pods
will report requests larger than the manifest asks for, which is expected and not drift.
Autopilot is also regional, so it runs a node per zone; and it restricts privileged
workloads, which is fine for the delegate and the application but would matter for
node-level agents.

**One self-inflicted error during the switch.** The first Autopilot attempt failed with:

```
Constraint constraints/compute.vmExternalIpAccess violated for project ...
```

Autopilot defaults to nodes with external IPs, which is exactly what Finding 1 documented
as forbidden here. `--enable-private-nodes` fixed it. Recorded because the mistake is
instructive: I had already written the finding and still failed to apply it to a new
resource type. **A documented constraint is not an applied constraint** — org policies bind
every resource that creates VMs, and each new provisioning path has to be re-checked
against them rather than assumed compliant.

The regional Cloud NAT needed no change; it already covered every zone Autopilot places
nodes in.

**References.**
- Org policy constraints: https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints
- Master authorized networks: https://cloud.google.com/kubernetes-engine/docs/how-to/authorized-networks
- Resizing a cluster: https://cloud.google.com/kubernetes-engine/docs/how-to/resizing-a-cluster
- Resource availability / stockouts: https://cloud.google.com/compute/docs/troubleshooting/troubleshooting-vm-creation
- Autopilot overview: https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview
- Autopilot resource minimums: https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests
- GKE private clusters: https://cloud.google.com/kubernetes-engine/docs/how-to/private-clusters
- Cloud NAT: https://cloud.google.com/nat/docs/overview
- kubectl auth plugin: https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl

---

## 2. Harness trial & delegate install

**Goal.** A delegate running in-cluster and connected to the Harness control plane.

**Approach & rationale.** Installed via the **Helm chart** rather than the raw Kubernetes
manifest. Helm was already required for the lab, upgrades become `helm upgrade` instead of
re-applying YAML, and the release is cleanly removable — closer to how a customer would
actually run it. The delegate was named `webo-moneyworld`; that name is what delegate
*selectors* reference later when scoping a connector or a pipeline stage.

**What the chart creates.** A `Deployment` (not a StatefulSet — the delegate has shipped as
each across versions, which is why the lifecycle scripts scale both kinds), plus an hourly
`CronJob` that self-upgrades the delegate. The upgrader is worth knowing about: it is a
standing background workload, and a customer wanting a pinned delegate version would need
to disable it.

**Gate G2 — delegate pod and health** ✅
```
$ kubectl get pods -n harness-delegate-ng
NAME                               READY   STATUS    RESTARTS   AGE
webo-moneyworld-857df956bb-5lnpf   1/1     Running   0          116s

$ kubectl exec -n harness-delegate-ng <pod> -- curl -s -o /dev/null -w "%{http_code}" \
    http://localhost:3460/api/health
200
```

Ready after ~45 seconds, **zero restarts**.

### Reading the startup errors correctly

For the first ~45 seconds the logs were full of stack traces:

```
Caused by: io.harness.health.HealthException: Delegate is not healthy. Heartbeat has expired.
... "GET /api/health HTTP/1.1" 500 110 "-" "kube-probe/1.35"
```

**This is the readiness probe working, not a failure.** The delegate serves `/api/health` as
500 until it completes its first handshake with Harness, so Kubernetes correctly holds the
pod at `0/1` and keeps it out of service until it can actually do work. A delegate that
reported `Ready` immediately would be the suspicious outcome. The signal to wait for is the
transition to 200 — which is also the cluster-side confirmation of "Connected" in the UI,
obtainable without opening the console.

### Autopilot resource mutation, confirmed

The install emitted:

```
Warning: autopilot-default-resources-mutator: Autopilot updated CronJob
harness-delegate-ng/webo-moneyworld-upgrader-job: defaulted unspecified 'cpu'
resource for containers [upgrader]
```

This is the behaviour predicted when the cluster moved to Autopilot, now observed on a real
workload: Autopilot rewrites unspecified or under-minimum resource requests. Application
pods will therefore report requests larger than `k8s/values.yaml` declares. That is expected
and not configuration drift — which is why the base values file now states Autopilot's real
minimums explicitly rather than smaller numbers that would be silently rewritten.

### Finding 8 — Cloud NAT is not effective the moment it is created

Bringing the cluster back before installing, `lab-up.sh` created Cloud NAT and immediately
reported success. An egress check run seconds later failed:

```
app.harness.io HTTP 000 in 5.05s      # no response at all, not a rejection
```

Retried a minute later, from the same cluster with no configuration change:

```
--- DNS ---      Address: 35.201.91.229
--- TCP/TLS ---  harness  HTTP 401 connect=0.039s
--- generic ---  google   HTTP 200
```

Cloud NAT takes a minute or two to become effective after creation. `HTTP 000` versus an
HTTP status is the distinguishing signal — no response at all means no path, whereas a 401
means the path is fine.

The consequence is a trap: `lab-up.sh` declares "Lab resumed" as soon as NAT is *created*,
so a delegate started immediately afterwards would fail its initial registration with an
error that looks like a Harness problem. Follow-up: `lab-up.sh` should verify egress rather
than assume it, on the same principle as every other gate in this document — assert the
observable behaviour, not the API call's return value.

**Confirmed in the Harness UI:** delegate `webo-moneyworld`, connectivity **Connected**,
version 26.07.89703, last heartbeat 26 seconds ago. Both the parent delegate entry and its
pod instance report Connected.

Worth noting the console shows *Auto Upgrade: DETECTING* — the upgrader CronJob had not yet
run its first hourly pass. A customer who wants a pinned delegate version would disable that
job rather than leave it self-updating.

**Screenshot:** `screenshots/02-delegate-connected.png` *(crop the account ID from the URL bar and the signed-in email from the header)*

**References.**
- Delegate install: https://developer.harness.io/docs/platform/delegates/install-delegates/overview/
- Autopilot resource defaults: https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests

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

- **The build host is ephemeral.** A build pod is torn down when the build ends — this is true
  of Harness Cloud runners and of self-hosted `KubernetesDirect` pods alike. An image existing
  only on the build host's local daemon evaporates minutes later.
- **The cluster cannot reach the build host.** Nodes pull images themselves, on their own
  initiative. They need a durable, authenticated, network-reachable address.
- **It is the CI/CD boundary.** CI's job ends at "produce an artifact"; CD's begins at
  "consume an artifact." That decoupling is exactly why the two stages *can* run on entirely
  different infrastructure and still compose — and it is what made switching CI from Harness
  Cloud to self-hosted Kubernetes (Finding 16) a build-infrastructure change rather than a
  redesign. The CD stage never knew or cared where the image was produced.

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

### Gate G3 — connectors ✅

| Connector | Identifier | Auth | Connectivity | Test |
|---|---|---|---|---|
| GitHub | `github` | PAT in Harness secret `github_pat` | Harness Platform | ✅ |
| Docker Hub | `dockerhub` | Access token in `dockerhub_token` | Harness Platform | ✅ |
| Kubernetes | `gkeautopilot` | **Delegate credentials**, tag-scoped to `webo-moneyworld` | via delegate | ✅ |

**The Kubernetes connector stores no cluster credentials at all.** The alternative offered —
"specify master URL and credentials" — would mean pasting the control-plane endpoint and a
service-account token into a SaaS platform, and requiring that endpoint to be reachable from
outside. Choosing delegate credentials instead means the delegate authenticates locally with
its mounted service-account token and **the credential never leaves the cluster**. That is
the clearest single argument for the delegate model, and it is a configuration choice rather
than a claim.

The connector is scoped by delegate **tag** rather than "any available delegate". With one
delegate the behaviour is identical, but the habit matters: once a customer runs delegates in
dev, staging and prod, "any available" means a dev-scoped delegate can be handed a prod
deployment. Tag-scoped selection is what keeps environments genuinely isolated.

**Connectivity modes are not arbitrary.** GitHub and Docker Hub connect through the Harness
Platform because both are publicly reachable; the Kubernetes connector has no such choice and
must go through the delegate. The same delegate-or-not distinction, surfacing as a config
option rather than as prose.

**The original reason for that choice stopped being true, and the choice stayed right.** It
was made while CI was still going to run on Harness Cloud, and the argument was that routing
GitHub and Docker Hub through the delegate would needlessly couple builds to the cluster being
up. Moving CI to self-hosted Kubernetes (Finding 16) coupled builds to the cluster anyway —
that argument is now void.

Platform connectivity is still correct, for a different reason: the connectors stay testable
from the Harness UI without a healthy delegate, which is exactly the state you are in when
diagnosing a delegate problem. A connector that can only be tested by the component you
suspect is not much of a diagnostic.

Worth flagging as a small instance of the Finding 19 pattern — a decision that outlived its
stated rationale. It survived review only because someone re-derived it. Nothing in the config
records *why* a connector is set to Platform, so nothing would have caught it.

A clarification in the UI worth quoting, because it resolves a common confusion:

> "A Harness Delegate will be used for deployment operations, even if Connect through Harness
> Platform is selected."

Connectivity mode governs only how Harness reaches *that provider*. It says nothing about how
deployments reach the cluster.

### Finding 10 — display names and identifiers drift apart

Two surprises, same root cause:

- The project shows as `k8s-cicd-lab` in every breadcrumb, but its identifier is
  `default_project` — the auto-created Default Project had been renamed rather than replaced.
- The Kubernetes connector is named `gke-autopilot`, but its identifier is `gkeautopilot`;
  Harness identifiers do not permit hyphens.

**Identifiers are immutable once created; display names are not.** Every pipeline, template
and API call references the *identifier*, so the string in the console and the string in
automation can diverge permanently. Renaming does not fix it — the identifier is fixed at
creation.

Practical consequence for anyone scripting against a customer account: read identifiers from
the API, never infer them from display names. A wrong identifier surfaces as "connector not
found", which reads like a permissions problem and is not.

Recorded for reference — these are what the templates reference:

```
orgIdentifier:     default
projectIdentifier: default_project
connectors:        github · dockerhub · gkeautopilot
secrets:           github_pat · dockerhub_token
delegate tag:      webo-moneyworld
```

### Finding 11 — the Harness CLI cannot manage connectors

Before clicking through three wizards, I checked whether this could be automated. `hc`
v1.3.40 (current) exposes only:

```
artifact · registry · iacm · auth
```

There is **no connector, pipeline, template, service or environment command** — the CLI is
scoped to Artifact Registry and IaCM. Platform-resource automation means the **Terraform
provider** (`harness/harness`, which has `platform_connector_*` resources for github, docker
and kubernetes) or the **REST API**.

Worth knowing before promising a customer a CLI-driven bootstrap. The Terraform provider was
the right tool and was deliberately deferred: connectors were created through the UI to keep
the critical path moving, with the note that a production setup would put the platform layer
(connectors, secrets, environments) in Terraform while leaving pipelines and templates to Git
Experience — two layers, two owners, one source of truth each.

### Smaller frictions worth recording

**"GitOps → Repositories" is not "Connectors".** Harness GitOps is a separate, pull-based
deployment model (ArgoCD underneath) with its own repository registry. Both are called
repositories and both live behind a "Settings" tab. Connectors are under *Project Settings*;
the GitOps section is unrelated to this lab.

**Docker Hub access tokens are shown exactly once.** The token was lost between creating it
and configuring the connector, requiring a fresh one. The old token was deleted rather than
abandoned — an unusable credential that still grants access is worse than no credential.
This is the argument for **one token per consumer**: the replacement is named
`harness-connector`, so revoking it at teardown revokes exactly Harness's access and nothing
else.

**Pipeline — Build stage.** Infrastructure is `KubernetesDirect` on the lab's own cluster,
namespace `harness-build`, through the `gkeautopilot` connector. Two steps, both template
references: `build and test` (a `Run` step executing `node --test` in `node:22-alpine`) and
`build and push image` (`BuildAndPushDockerRegistry`, tagging `<+pipeline.sequenceId>`).

**On tagging.** Images are tagged `<+pipeline.sequenceId>` rather than `latest`.
<!-- Explain the CI→CD seam: the CD stage resolves the same expression, so the two stages
     line up without brittle cross-stage step-output references. -->

**Why a delegate *is* involved here — and why that was not the plan.**

The heading this section originally carried was "Why no delegate is involved here," written
against the Harness Cloud design. It is worth preserving what the intended contrast was,
because the concept is real even though this implementation does not demonstrate it:

- **Harness Cloud** — builds run on Harness-hosted runners. No delegate, nothing to operate,
  and CI keeps working when your cluster does not.
- **Self-hosted (`KubernetesDirect`)** — builds run as pods in your cluster, scheduled by the
  delegate. You own the capacity, the image cache and the failure modes.

CD has no equivalent choice. It must reach a Kubernetes API server that Harness cannot
address, so it always goes through the delegate.

Harness Cloud requires credit-card validation, which a trial account does not have
(Finding 16), so CI here runs self-hosted and the delegate executes both halves of the
pipeline. The accurate statement is therefore *"CI can be delegate-free and CD cannot"* —
not *"CI needs no delegate"*, which is false of this repo.

**The practical consequence is a coupling that was not designed in.** Parking the cluster
stops CI as well as CD. Pushing to `main` while parked produces a run with no delegate to
execute it, rather than a build that succeeds and waits for a deploy target. On Harness Cloud
the CI stage would have gone green regardless.

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

### Execution history — four runs, and what each taught

| Run | Result | Cause |
|---|---|---|
| 1 | FAILED at Initialize | `image is required` — the step template was authored for Harness Cloud, where a Run step needs no container image. Kubernetes build infrastructure requires one (Finding 14 area) |
| 2 | FAILED at build and test | `Cannot find module '/harness/app/test'` — local Node 18 vs container Node 22 (Finding 14) |
| 3 | EXPIRED after 11m52s | Pods could never start; `Wait for Steady State` waited its full timeout, then auto-rollback fired (Findings 15 and 16) |
| 4 | **SUCCESS** — dev → approval → prod | — |

Three failures with three unrelated root causes, none of which any pre-deploy check could
have caught. That progression is the substance of this lab; the green run is just the
terminator.

**Gate G5 — pods running** ✅
```
$ kubectl get deploy -n dev
NAME               READY   DESIRED   IMAGE
webo-money-world   2       2         index.docker.io/<REGISTRY_USER>/harness-lab-app:4
```
Ready in roughly seventy seconds from stage start.

**Gate G6 — reachable over HTTP** ✅
```
$ curl http://<DEV_LB_IP>/api/version
{"application":"webo-money-world","version":"1.0.0","build":"4",
 "instance":"webo-money-world-6ccf94977d-8rn7j"}
```

`"build":"4"` is the CI/CD seam proving itself. CI tagged the image `4` from
`<+pipeline.sequenceId>`, the Deployment injected `BUILD_ID` from the same expression, and
the running pod reports it. **A container in the cluster is traceable to the exact pipeline
execution that produced it** — not by convention, but because the same expression resolved
in both stages.

**Gate G9 — the approval gate genuinely blocks** ✅

The pipeline stopped at `approve prod` and stayed stopped. Not a confirmation dialog: the
execution state is *persisted as waiting*, with a one-day timeout. Close the browser and it
is still waiting. The log line `Sending notification to user groups for harness approval`
shows the mechanism — approval is delegated to a named user group, not to whoever happens
to be watching, which is what makes "only the release team may promote to production" a
control rather than an honour system.

**Gate G11 — environment overrides genuinely differ** ✅

The single most useful piece of evidence in this lab:

```
dev:   replicas=2   cpu=250m   mem=512Mi   image=...harness-lab-app:4
prod:  replicas=3   cpu=500m   mem=1Gi     image=...harness-lab-app:4
```

Different replica counts, different resource requests, **identical image**. That is:

- **one** service definition, rendered twice — `<+env.identifier>` resolved to `dev` and
  `prod` and pulled different override files, with no per-environment service objects
- **one** stage template, referenced twice, differing only by input
- **one artifact promoted, not rebuilt** — prod runs the exact bytes dev validated

The last point is what immutable tagging buys. "What we tested" and "what we shipped" are
the same artifact, and it is provable from the cluster rather than asserted.

**Gate G13 — automatic rollback** ✅ (demonstrated unintentionally on run 3)

No per-stage configuration was written for this. `failureStrategies: StageRollback` is
pinned in the stage template, so every consumer inherits it whether or not they thought
about rollback. That is the argument for putting it in the template rather than leaving it
to each team to remember.

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

## Git Experience — pipelines and templates as code

**Goal.** Store pipelines, templates, services and environments as YAML in this repository,
so the Harness half of the submission is reviewable in git rather than invisible behind a
login — and so pipeline changes can be reviewed like any other change.

**Set up before authoring anything.** Configured at *Project Settings → Default Settings →
Git Experience*: default connector `github`, default repository `k8s-cicd`, **Default Store
Type For Entities: REMOTE**, and **Enforce git experience** enabled.

That last checkbox is the one that matters. Without it, Remote is merely the *default* and
anyone can still create an Inline entity — so "everything is in Git" is a habit rather than a
guarantee, and the one pipeline somebody created inline is the one nobody reviews. With it
enabled, the Inline option is greyed out entirely. The difference between a **convention and
a control**.

**Gate G12 — the first remote entity landed in the repo** ✅

```
$ git log --oneline main..origin/main
a803d3d Create template build and test

$ git ls-tree -r --name-only origin/main -- .harness
.harness/orgs/default/projects/default_project/templates/build_and_test/v1.yaml
```

Harness committed directly to `main` despite the branch ruleset requiring pull requests —
the admin bypass applied, because the PAT belongs to the repository owner.

**On the path layout.** Harness generates a hierarchical path including the version:
`.../templates/build_and_test/v1.yaml`. My instinct was to flatten this to
`.harness/templates/build_and_test.yaml`, which would have been a mistake: **the version in
the filename means `v2` lands beside `v1` rather than overwriting it**, so template versioning
becomes visible and diffable in git. The single most compelling part of the templates story
would otherwise have been invisible in the repository.

### Finding 13 — "Enforce git experience" does not cover every entity type

With enforcement enabled, Inline is greyed out when creating templates, services and
environments — Remote is the only choice. That worked: seven Harness-authored commits landed
three templates, the service and both environments in the repository.

**Infrastructure definitions are the exception.** Opening one shows the *inverse*: **Inline
selected, Remote greyed out**. They cannot be *created* as Remote.

They can nonetheless be put in Git two other ways: **Import Infrastructure From Git** (a
dropdown beside the create button), or **Move to Git** (a per-row action in the overflow
menu). Both exist; neither is the create flow.

So the accurate claim is narrow: **infrastructure definitions cannot be *created* as Remote,
but an existing one can be moved to Git in two clicks.** The capability is present — only the
creation path omits it.

I got this wrong twice before arriving there. First I claimed they "cannot be stored in Git at
all", which the Import action disproved. Then I claimed you must hand-author and import, which
"Move to Git" disproved. Both corrections came from *looking again*, not from reasoning
harder, and the claim narrowed each time — from "the platform is incapable" to "the default
path is inconsistent". Worth recording as-is: the first version would have been an unfair
thing to tell a customer, and it took two rounds of evidence to stop being unfair.

```
$ git ls-tree -r --name-only origin/main -- .harness
  envs/pre_production/dev.yaml
  envs/production/prod.yaml
  services/webo_money_world.yaml
  templates/build_and_push_image/v1.yaml
  templates/build_and_test/v1.yaml
  templates/deploy_to_kubernetes/v1.yaml
        # no infrastructure definitions — though they existed in Harness
```

**Closed rather than accepted.** `prod_k8s` was moved to Git with the per-row action, and
Harness wrote it to `.harness/.../infras/prod_k8s.yaml` — the same path convention used for
every other entity. The configuration is now genuinely in version control.

The residual point stands: this only happened because the absence was noticed. Nothing warns
that an entity type is exempt from an enforcement setting, and the way to find out is to list
the repository and spot what is missing. **Absences are hard to see**, which is why the check
has to be a positive assertion — "these six files exist" — rather than an assumption that
enforcement did its job.

**Why this matters beyond tidiness.** The setting is named "Enforce git experience", it
visibly enforced Remote everywhere else, and then made an undocumented exception. Anyone
would reasonably conclude their configuration is fully in version control. It is not:

- **A restore from the repository comes back incomplete.** Templates, service and
  environments return; the infrastructure definitions binding them to a cluster and namespace
  do not — discovered mid-incident, which is the worst possible time.
- **Part of the delivery config escapes review.** Namespace and cluster connector are exactly
  the fields worth seeing in a pull request before a change reaches production, and they are
  the ones absent from it.
- **The failure is silent.** No warning, no badge, nothing in the setup flow. It is visible
  only by listing the repository and noticing an *absence*, and absences are hard to notice.

Impact here is small: two objects, thirteen lines each. The lesson is not.

**What I would tell a customer.** Do not assume enforcement implies completeness — verify
what actually lands in the repository, per entity type, before relying on it for disaster
recovery or review coverage. Same principle as Finding 9: assert against the observable
artifact, not against the setting that claims to produce it. A configuration toggle states
intent; the file listing is evidence.

### Finding 12 — Git Experience adds a second committer, and it borrows a human identity

The commit Harness created was authored as:

```
a803d3d  vlad <PERSONAL_EMAIL_REDACTED>
```

Every other commit in the repository uses a GitHub noreply address. This one exposed a
personal email — on a public repository, after deliberate effort to keep identifiers out of
it.

**The obvious fix does not work.** GitHub's *"Keep my email addresses private"* was **already
enabled**. Its scope is narrower than it appears:

> "...when performing **web-based Git operations** (e.g. edits and merges)"

Harness performs neither. It commits through the **API** with a PAT, supplying an explicit
author, and GitHub records what it is given. *"Block command line pushes that expose my
email"* does not apply either — these are not command-line pushes.

The address almost certainly comes from **Harness's own user record**, not GitHub's: the
commit author name is `vlad`, which matches neither the git config (`vlad-ko`) nor the GitHub
login, but does match the Harness account.

**The general lesson, which is the useful part.** Enabling pipeline-as-code **adds a second
writer to your repository**, and unless you deliberately give it its own identity, it borrows
a human's. For a customer with commit-signing requirements, protected-branch audit rules, or
a need to distinguish "a person changed this" from "the platform synced this", that is a real
problem rather than a cosmetic one — and it is not mentioned anywhere in the setup flow.

**The production answer** is to authenticate Harness as a **dedicated machine user or GitHub
App** rather than a personal PAT. Commits are then authored by the automation, revoking its
access does not disturb a person's account, and the audit trail stays honest.

Accepted as-is for the lab: the address is already present in public commit history
elsewhere, and force-pushing over a branch Harness is actively syncing against risks a real
sync conflict for a cosmetic gain.

---

### Finding 14 — the local runtime was not the runtime that mattered

I ran the application's tests locally, reported **40/40 passing**, and treated the app as
verified. The pipeline then failed on the identical command:

```
cd app && node --test test/
  Error: Cannot find module '/harness/app/test'
```

Local Node was **18.20.8**. The container is `node:22-alpine` — **22.23.2** — and Node 22
resolves a bare directory argument as a *module path* rather than a test directory. Same
command, same repository, different answer.

The Dockerfile has said `node:22-alpine` since the application was containerized. The app was
always going to run on 22; I validated against 18 because that is what was installed.

Reproduced and fixed against the real image rather than by guessing:

```
$ docker run --rm -v "$PWD/app:/app" -w /app node:22-alpine node --test test/
  Error: Cannot find module '/harness/app/test'          # reproduced

$ docker run --rm -v "$PWD/app:/app" -w /app node:22-alpine node --test
  # tests 40 · pass 40 · fail 0                          # fixed
```

Bare `node --test` uses the runner's own discovery and works on both versions.

This is a distinct variant of Finding 9. The check was not broken and did not lie — it ran
correctly and reported truthfully **about the wrong environment**. "Tests pass" is not a fact
about a repository; it is a fact about a repository *on a particular runtime*, and CI runs a
different one. The fix that generalises is not "be careful" but **run the check inside the
image the pipeline will use**, which took one `docker run` and would have caught it before
the first pipeline run.

Worth noting where the fix landed: entirely in the **pipeline**, not the template. The
template declares `command: <+input>` and is indifferent to the toolchain. A Maven service
sharing that template was never affected.

### Finding 15 — two correct hardening choices that are incompatible together

The first deployment reached the cluster, pulled the image, and then refused to start:

```
Error: container has runAsNonRoot and image has non-numeric user (node),
       cannot verify user is non-root
```

The Dockerfile declared `USER node`. The pod spec declared `runAsNonRoot: true`. Kubernetes
cannot resolve a *username* to a uid without starting the container, so it cannot prove the
user is non-root and refuses outright with `CreateContainerConfigError`.

Each decision is defensible in isolation, and both were made for the same reason — don't run
as root. They are incompatible because one states the intent in a form the orchestrator
cannot check. The fix is not to weaken either: it is to say the same thing numerically —
`USER 1000` in the image, `runAsUser: 1000` in the pod spec.

**Nothing catches this before the cluster.** The image builds. The manifest validates. The
deploy applies. `scripts/validate-manifests.sh` passes, because the values all resolve. The
first signal is the kubelet declining to start the container — which is exactly what happens
when a platform team's pod-security baseline meets an application team's Dockerfile, each
written correctly and independently.

**Diagnosing it from the logs is its own lesson.** The event stream contained dozens of lines,
including repeated `0/3 nodes are available: 2 Insufficient memory` scheduling warnings that
look far more alarming. Those were noise — Autopilot resolved them by adding a node. The real
cause was one line that *repeated identically* about thirty times. The signal is not severity;
it is **which error never changes**.

### Finding 16 — the platform's own remediation hint was wrong

When the deploy stage expired, Harness surfaced:

> "Please Check the timeout configuration on the step to extend the duration of the step"

Following it would have doubled the wait for a condition that could never become true. Nothing
was slow. `Wait for Steady State` was correctly waiting on pods that were structurally unable
to start, and the 10-minute timeout was the only thing preventing an indefinite hang — the
mechanism working, not failing.

A timeout expiring has two possible meanings — *too slow* or *never going to happen* — and the
platform assumed the first. Worth remembering both for a customer: the instinct to raise a
timeout is right about half the time, and wrong in exactly the cases where waiting longer costs
the most.

The same run also demonstrated **Gate G13 unplanned**: the stage's `failureStrategies` fired
automatic rollback with no per-stage configuration, because that block is pinned in the stage
template. Every consumer of that template gets rollback whether they thought about it or not,
which is the argument for putting it there rather than leaving it to each team.

### Smaller frictions from the same session

**Build infrastructure changes what a template must declare.** The `build_and_test` template
was authored for Harness Cloud, where a Run step executes directly on the host and needs no
container image. On Kubernetes build infrastructure every step runs in a pod, so `image` is
mandatory — and the template failed at `Initialize` with a clear message. Neither the template
nor the pipeline validation catches this at save time. The durable fix was making `image` a
**runtime input** rather than omitting or hard-coding it, so the same template now works on
both infrastructures.

**Harness Cloud build infrastructure requires credit-card validation**; self-hosted does not.
The free tier is genuinely free either way, but that gate is worth knowing before recommending
Harness Cloud to someone evaluating the product.

**The local Docker runner was the wrong self-hosted choice here** — it runs builds on the
developer's machine, which is arm64, while the cluster is amd64. That mismatch would have
produced images that push successfully and then fail at runtime with `exec format error`,
naming nothing useful. Kubernetes build infrastructure runs builds on the cluster's own amd64
nodes, matching the deployment target by construction.

**Revoking a registry token does not clean up the client.** After deleting the old Docker Hub
token, the cached credential remained and broke even *anonymous* pulls of public images, with
`authentication required - incorrect username or password`. `docker logout` fixed it. The error
suggests a wrong password; the truth was a credential that should not have been presented at
all.
### Finding 17 — Autopilot forbids writes to `kube-system`, which breaks common tooling

Adding HTTPS meant installing cert-manager. It installed cleanly — all three pods `Running`,
zero restarts — and then every `ClusterIssuer` was rejected:

```
Internal error occurred: failed calling webhook "webhook.cert-manager.io":
  x509: certificate signed by unknown authority
```

Healthy-looking pods made this read as a transient CA-injection delay. It was not. The
cainjector logs had the real answer:

```
Error initially creating lease lock: leases.coordination.k8s.io is forbidden:
  User "system:serviceaccount:cert-manager:cert-manager-cainjector" cannot create
  resource "leases" in namespace "kube-system": GKE Warden authz
  [denied by managed-namespaces-limitation]
```

cert-manager's cainjector defaults to taking its leader-election lease in `kube-system`.
**Autopilot forbids all writes to `kube-system`** — it is a managed namespace. So cainjector
never acquired leadership, never ran, never injected the CA bundle into the webhook
configuration, and the webhook rejected everything. One flag fixes it:

```
--set global.leaderElection.namespace=cert-manager
```

CA injected within five seconds.

**Two things worth carrying from this.** First, `Running` is not `working` — three healthy
pods and the component was doing nothing at all. Second, this is the concrete cost of
Autopilot's managed control plane: it removes a class of operational burden by removing a
class of permission, and tooling that assumes full cluster access needs configuring. A fair
trade, but a trade — and worth telling a customer before they meet it mid-install.

### Finding 18 — a production CDN wildcard blocked the obvious DNS approach

Exposing the app over HTTPS needed a hostname. The domain sits at a host with an active CDN,
and the DNS zone editor stated:

> "There is an active CDN for the selected domain, meaning that its **A and AAAA** records
> cannot be managed."

Worse, the CDN had a **wildcard** across the zone — an entirely invented hostname resolved:

```
$ dig +short nonexistent-test-xyz.<DOMAIN>
  34.160.81.203  34.149.120.3  ...        # CDN answered, not NXDOMAIN
```

So the intended lab hostnames already resolved — to the CDN. An ACME HTTP-01 challenge would
have been answered by the CDN rather than the cluster.

**The tempting fix was wrong.** Deactivating the CDN would have repointed a live production
site at its origin mid-afternoon to unblock a lab subdomain. Declined.

**The actual fix was to read the restriction precisely.** Only **A and AAAA** records were
CDN-managed. `CNAME` was not — visible in the zone's own records, where an existing subdomain
was already a CNAME. And a *specific* record beats a wildcard, because a wildcard only
matches names with no explicit record. So:

```
webomoney-dev.<DOMAIN>.  CNAME  <INGRESS_IP>.sslip.io.
<INGRESS_IP>.sslip.io.   A      <INGRESS_IP>
```

Real hostnames on the real domain, resolving to the cluster ingress, production CDN
untouched, no A record required. Let's Encrypt issues for the name requested rather than the
CNAME target, so the certificate covers the real domain and the shared-domain rate limits
that make `sslip.io` unreliable never apply.

**The generalisable lesson is about reading restrictions narrowly.** "A and AAAA cannot be
managed" is not "DNS cannot be managed", and a wildcard is not an override. The workaround
existed *inside* the constraint; the reflex of removing the constraint would have caused a
production incident to solve a lab problem.

It also gives the organisation's own deferred DNS-migration work a concrete justification: a
CDN wildcard that captures every subdomain means no hostname can be delegated elsewhere
without touching production. That is a platform constraint, not a preference.

---

## Git Experience — a cross-cutting constraint, not a storage setting

Five separate frictions surfaced from one decision, and they share a shape worth being able
to articulate.

**Going in, Git Experience looks like a storage choice**: where do my pipelines live,
Harness's database or my repo? In practice it is a **constraint that propagates across the
platform**, and its edges are discovered at use time rather than at configuration time.

| # | What happened | What it means |
|---|---|---|
| 1 | Infrastructure definitions cannot be *created* as Remote — only imported or moved afterwards | Enforcement does not imply completeness |
| 2 | Triggers reject inline `inputYaml`; inputs must come from a repo-stored Input Set | Runtime inputs become reviewable artifacts |
| 3 | Manual runs must *select* an Input Set rather than typing a value | Convenience of the rare path is spent on rigour of the common one |
| 4 | The Input Set YAML editor allowed Save with no file path, then failed on push | Uneven coverage across entity types |
| 5 | Triggers themselves are not stored in Git at all | The "everything as code" claim needs qualifying |

**None of these is a defect.** Points 2 and 3 in particular are Harness being principled: if a
deployment's inputs are not in version control, a pipeline execution cannot be reproduced or
reviewed, and "it ran with different inputs last time" becomes unanswerable. Forcing inputs
into the repo is the correct trade.

**But the trade is real and nobody announces it.** Enabling Git Experience quietly changes
how triggers are configured, how manual runs are launched, and which entity types you can
create through the normal flow. Every one of those was discovered by hitting it mid-task,
with an error message that explains the rule but never why it exists.

### How I would frame this to a customer

Not "Git Experience has rough edges" — that is both unfair and unhelpful. Rather:

> Git Experience is not a place to put your YAML. It is a decision that **everything
> influencing a deployment must be reviewable**, and the platform enforces that decision in
> places you will not anticipate. Budget for discovering its boundaries, and expect the cost
> to land on interactive workflows — manual runs, quick edits, one-off triggers — because
> those are exactly the paths that bypass review.

That framing predicts every friction above from a single principle, which is more useful than
a list of gotchas — and it makes the trade explicit up front rather than discovered on day
three.

**Worth being clear about the payoff**: ten Harness entities in this repository, reviewable
in pull requests, diffable, and restorable. A three-tier template hierarchy visible as files.
The `webo_cicd` pipeline collapsing from 105 lines to 60 as a diff rather than an assertion.
None of that exists without accepting the constraint.

---

## Cross-cutting Finding 9 — four verifications that lied

Individually these are small. Together they are the most useful thing this lab produced, so
they are collected rather than left scattered.

**Four times, a check reported the wrong answer** — three false passes and one false failure —
and in every case the check failed for a reason unrelated to what it was checking.

| # | The check | What actually happened |
|---|---|---|
| 1 | `docker push -q … \| tail -3` | The pipe returned **`tail`'s** exit status, so a failed push looked successful and `set -e` never fired. Printed a green checkmark over a push that never happened. |
| 2 | `${PIPESTATUS[0]}` guard, rewritten to fix #1 | `PIPESTATUS` is a **bash** array. This shell is **zsh**, where it is `pipestatus`. It expanded empty, the guard compared against an empty string, and success was reported again. |
| 3 | `curl localhost:8080` against a new server | **Docker Desktop already held port 8080.** The server died with `EADDRINUSE` and every response — including the "blocked" 404s that appeared to prove the static allowlist worked — came from Docker's listener. A completely clean-looking pass that tested nothing. |
| 4 | `replicas_for` after a bug fix | Sourced the script from **zsh**, where `BASH_SOURCE` does not exist, so the path base fell back to the cwd and every lookup missed. Reported `1, 1, 1` and looked like the fix had failed. It had not. |

Finding 6 is the same class in the opposite direction: `gcloud container clusters resize`
exits non-zero while the operation succeeds server-side.

### What actually catches these

**Assert on the artifact, not the exit code.** `$?` describes the *command's* experience, not
the world. The registry check only became trustworthy when it stopped reading exit codes and
started fetching the manifest with an anonymous token — the same path a cluster node takes.
`HTTP 200` on a real manifest cannot be faked by a shell quirk.

**Negative-test the check itself.** `scripts/validate-manifests.sh` is trustworthy *because*
a typo was deliberately induced to confirm it fails. The push checks had never been observed
failing, and it showed. A check that has only ever passed is an untested branch.

**Verify the precondition before the assertion.** Incident 3 was caught only because the 404
body had a trailing period the real server does not emit. The fix was to assert *"is this my
server?"* before asking it anything — the rerun greps the startup log for the expected
`listening on` line and aborts if absent.

**Know which shell is running.** Two of the four were zsh/bash differences. Scripts carry a
bash shebang and behave correctly when executed; the errors came from ad-hoc verification run
in the ambient shell.

The general principle: **a check that cannot fail is worse than no check**, because it
manufactures confidence. This is doubly true in a CI/CD context, where the entire product is
automated verification — a green pipeline that verifies nothing is precisely the failure mode
a customer will not notice until production.

---

## Working practice

Work is tracked in GitHub issues with acceptance criteria; `main` is protected by a ruleset
requiring pull requests, with no force-push and no branch deletion, and admin bypass so the
solo author is never locked out. Each change lands as `issue → branch → PR (closes #N) →
merge`.

The first thirteen commits went directly to `main` before this was set up. That was a process
gap; it is recorded rather than quietly rewritten.

The repository is public, which was a deliberate decision taken **after** a full-history scan:
every blob across every commit, all commit messages, and author identity were checked for
account identifiers, billing IDs, tokens, endpoints and personal email. Author email is a
GitHub noreply address throughout. Private working material (`docs/LAB-PLAN.md`) and local
config (`scripts/lab.env`) are gitignored, and screenshots are cropped — the Harness console
shows the account name in its breadcrumb and the signed-in email in its header.

---

## Exercise 5 — the template hierarchy, completed

Four templates, three tiers, all consumed:

```
templates/build_and_test/v1.yaml         step     — command, image, connector as inputs
templates/build_and_push_image/v1.yaml   step     — connector, repo, dockerfile, context
templates/deploy_to_kubernetes/v1.yaml   stage    — referenced TWICE (dev, prod)
templates/service_cicd/v1.yaml           pipeline — 12 runtime inputs
pipelines/webo_cicd.yaml                 60 lines of pure input
```

**The pipeline collapsed from 105 lines to 60**, and everything remaining is a repo name, a
test command, a base image, an image path, or a service reference. Nothing about *how* to
deploy.

### What is input and what is policy

The pipeline template's design is the argument. Consumers supply what to build and where to
push it. They cannot supply:

| Fixed | Consequence |
|---|---|
| `dev → approve → prod` | No service skips dev or reaches prod unapproved |
| The approval stage itself | Cannot be removed by a consumer |
| `tags: [<+pipeline.sequenceId>]` | `latest` is unreachable |
| `failureStrategies: StageRollback` | Every deploy has rollback, thought about or not |
| Build infrastructure | Every build runs in the same place |

That is the difference between *having a template* and *having a platform*. The promotion path
is policy expressed as a template rather than a wiki page nobody reads — and a team cannot
opt out without authoring a different template, which is a visible act rather than a quiet
omission.

### Two claims proven rather than asserted

**Templates are app-agnostic.** The pipeline was designed around a Java/Maven service and now
builds a Node application. That swap cost template *inputs* and zero template edits. Nothing
in any template names a language, build tool, or image.

**The migration is behaviour-preserving.** `webo_cicd` was converted from a standalone
105-line pipeline to a template reference, re-run, and produced an identical deployment. That
matters more than it sounds: **no customer rewrites working pipelines to adopt templating.**
The path has to be "point the existing pipeline at a template and confirm nothing changed",
and that path works.

### The claim about a third environment

Adding `staging` would require: an Environment, an Infrastructure Definition, a values file,
and one stage reference in the pipeline template. No new service, no new templates, no
changes to any existing template. The estimate of roughly ninety seconds is defensible —
though honestly, most of that would be waiting for the environment YAML to sync.

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
