# CLAUDE.md — Harness Implementation Engineering Lab

Project guidance for Claude Code. Read this before doing anything in this repo.

---

## 1. What this project is

This repo is the submission for the **Harness Implementation Engineering Lab** — a
take-home exercise that builds a complete CI/CD path: source → Harness CI build →
container image in a public registry → Harness CD deploy onto Kubernetes, plus a
templatization bonus.

**This is not a product codebase.** It is an *evidence-producing* repo. The application
inside it is deliberately trivial; the artifact being graded is the **pipeline, the
Harness configuration, and the written record of how they were built and debugged**.
Optimize every decision for demonstrability, not for application features.

### The lab's own framing (quoting the brief)

> "By design, this lab does not walk through each activity step-by-step. The aim is to
> encourage information finding, making mistakes, and diagnosing why things don't quite
> work as expected."

> "please capture screenshots, notes, and any relevant links in a separate document for
> later review."

Two consequences that govern how work happens here:

1. **A documented failure is worth more than a silent success.** When something breaks,
   the diagnosis is the deliverable. Never quietly retry until it works and move on —
   record the symptom, the hypothesis, the check that confirmed or refuted it, and the
   fix. That trail is the primary scored signal.
2. **Do not seek a step-by-step script.** Prefer reading official docs and reasoning to
   asking for exact commands. Cite the doc URL you used in the notes.

---

## 2. Scope

### The five required exercises

| # | Exercise | Definition of done |
|---|---|---|
| 1 | Kubernetes cluster | Cluster reachable; `kubectl get nodes` all `Ready` |
| 2 | Harness trial + delegate | Delegate shows **Connected** in Harness; pod `Running` in-cluster |
| 3 | Harness CI | Pipeline green; tagged image present in the public registry |
| 4 | Harness CD | Same pipeline, added deploy stage; app serving traffic from the cluster |
| 5 | Bonus — templates | A step template published and *referenced* by the pipeline |

### Framing: this is a customer reference implementation, not a checkbox run

The brief calls templatization "one of the biggest value propositions of Harness." For an
implementation-engineering role, reusability **is** the product story — so the submission
is built as a **customer-like reproduction of a production environment**, not the minimum
that satisfies exercise 5. The bar is "would this stand up as a reference implementation
in front of a customer?"

That deliberately expands scope beyond the literal five. The expansion is the point.

### The template hierarchy (the core deliverable)

Three tiers, because each demonstrates reuse at a different altitude:

| Tier | Template (`v1`) | Reuse demonstrated |
|---|---|---|
| **Step** | `build and test`; `build and push image` | Runtime inputs for image / connector / command / repo / Dockerfile |
| **Stage** | `deploy to kubernetes` | Referenced **twice** — dev and prod — with service / environment / infrastructure as inputs |
| **Pipeline** | `service cicd` | Onboarding a second service becomes "reference + supply inputs" |

Identifiers are lowercase-with-underscores (`build_and_test`, `deploy_to_kubernetes`,
`service_cicd`); display names are the lowercase phrases above. Use the real names — earlier
drafts of this file invented title-case ones that never existed in the account.

The headline claim to be able to make and defend: **adding a third environment is a
~90-second template reference**, not a copy-pasted stage.

### Production-shaped delivery

- **dev → manual approval → prod**, one Service across two Environments
- **Rolling in both environments** — canary was descoped in #3 once the delivery path was
  complete; it would have shown a step type, not a missing capability
- **Environment-level `values.yaml` overrides** — replicas, resources, namespace
- **Auto-rollback** failure strategies on deploy stages
- **Webhook trigger** on push to `main`, with a repo-stored Input Set
- **HTTPS on real hostnames** — ingress-nginx + cert-manager + Let's Encrypt
- Secrets in the Harness secret manager, never inline

### Pipeline-as-code (Git Experience)

Pipelines, templates, services, and environments are stored as YAML under `.harness/` in
this repo and synced bidirectionally. Two reasons: it is the real customer pattern (pipeline
changes get PR review), and it makes the Harness work **reviewable in the repo** rather than
invisible behind a login.

### Still out of scope

Cluster provisioning does **not** belong in the delivery pipeline. Real organizations split
it — a platform team owns cluster Terraform, application teams own delivery — and that
separation also avoids the chicken-and-egg where a Terraform step destroys the cluster
hosting the delegate executing it. Cluster lifecycle is handled by `scripts/` for now;
Harness IaCM is the productized version and gets named in the write-up, not built.

---

## 3. 🔒 Secrets & identifying information — hard rules

This repo is shared with third parties. Treat every committed file as public.

**Never commit:**
- Email addresses, real names, or employer identifiers
- Cloud project IDs, account numbers, billing account IDs, org IDs
- Kubernetes cluster endpoints, node IPs, or kubeconfig files
- Registry usernames, tokens, PATs, or passwords
- The Harness delegate manifest (it embeds an account ID and delegate token)
- Harness account/org IDs or pipeline URLs containing them

**Instead, use placeholders** in all committed docs and manifests:
`<GCP_PROJECT_ID>`, `<CLUSTER_NAME>`, `<ZONE>`, `<REGISTRY_USER>`, `<HARNESS_ACCOUNT_ID>`.

**Screenshots must be redacted** before being committed to `docs/screenshots/` — Harness
console URLs contain the account ID, and the header shows the signed-in email. Crop or
box them out.

**Secrets at runtime** live in the Harness built-in secret manager and are referenced by
connectors. Never inline a credential into a pipeline YAML, a manifest, or a `values.yaml`.

Before every push, verify:

```
git diff --cached | grep -nEi '<the identifiers you are avoiding>'
```

`docs/LAB-PLAN.md` is **gitignored on purpose** — it is private working material for the
author's review and contains environment identifiers. Do not commit it, do not reference
its contents in committed files, and do not remove it from `.gitignore`.

---

## 4. Stack decisions (settled — don't relitigate)

This table records **what shipped**, not what was planned. Five rows changed under a
constraint discovered mid-build; where that happened the original is named, because the
reason for the change is usually the more useful thing to be able to explain.

| Area | Choice | Rationale |
|---|---|---|
| Cluster | **GKE Autopilot**, regional, **private nodes** + Cloud NAT | *Was: Standard, zonal, public.* Standard hit repeated zone capacity stockouts (Finding 7); an inherited org policy denies external IPs on VMs, so private nodes + NAT was the only path to delegate egress (Finding 1) |
| App | **Node 22** — a real Vercel app, containerized | *Was: Java + Maven, to match the linked quickstart.* Redeploying an app that already ships on Vercel makes the platform-rebuild story concrete instead of generic |
| CI infra | **Self-hosted `KubernetesDirect`**, namespace `harness-build` | *Was: Harness Cloud.* Harness Cloud requires credit-card validation, which a trial lacks (Finding 16). Consequence: CI depends on the delegate here, and `Run` steps need an explicit `image` (Finding 14) |
| CD infra | **Delegate** in-cluster | CD must reach the cluster's API server; only the delegate can. Unchanged |
| Registry | **Public** Docker Hub repo | The brief requires a public registry; public avoids an imagePullSecret |
| Ingress | **ingress-nginx + cert-manager**, one LoadBalancer, Let's Encrypt | *Was: LoadBalancer Service per environment.* Real HTTPS on real hostnames needs a shared ingress; per-env LoadBalancers cannot share a certificate issuer or an IP |
| Deploy strategy | **Rolling** in both environments | *Was: Rolling in dev, Canary in prod.* Descoped in #3 — the delivery path was already complete, and canary would have demonstrated a step type rather than a missing capability. The stage template makes it a one-template edit |
| Environments | **dev → approval → prod** | Proves promotion and stage-template reuse without doubling cluster load |
| Config storage | **Git Experience** (`.harness/`) | Pipeline changes get PR review; the work is visible in the repo |

**The delegate distinction is still a core concept this lab probes — state it accurately.**
Harness CI offers two build infrastructures: *Harness Cloud* (hosted runners, no delegate) and
*self-hosted* (`KubernetesDirect`, build pods scheduled by the delegate in your cluster). CD
has no equivalent choice; it must reach a private API server from outside, so it always needs
the delegate.

**This implementation uses self-hosted CI**, so the delegate executes both. Do not write "CI
needs no delegate" about *this* repo — it is true of Harness Cloud and false here. The
accurate framing is that CI *can* be delegate-free and CD cannot, and that a trial's billing
gate is what pushed this build onto the self-hosted path.

**When a decision in this table changes, update the table in the same PR.** README, this file
and `docs/LAB-NOTES.md` all restate the architecture; drift between them is what issue #25
existed to fix, and Finding 19 is the general case.

---

## 5. Repo layout

```
.
├── CLAUDE.md              # this file
├── README.md              # public-facing overview
├── app/                   # Vercel app + server.js (Node 22 runtime shim) + Dockerfile
├── k8s/
│   ├── deployment.yaml    # Go-templated manifests
│   ├── service.yaml       # ClusterIP — the one LoadBalancer belongs to ingress-nginx
│   ├── ingress.yaml       # host + TLS, cert-manager annotations
│   ├── values.yaml        # base values
│   └── env/
│       ├── dev/values.yaml    # environment overrides — replicas, resources
│       └── prod/values.yaml
├── .harness/              # pipeline-as-code: pipeline, templates, service, envs, infras, input set
├── scripts/               # cluster park/resume lifecycle, manifest validation
├── docs/
│   ├── LAB-NOTES.md       # ← the graded write-up
│   ├── LAB-PLAN.md        # gitignored, private
│   └── screenshots/       # redacted evidence
└── .claude/               # wizard skill + agent roster
```

### Conventions

- **The app exposes a version string** on its one endpoint. That is a deliberate test
  affordance: bumping it and re-running turns "did the redeploy actually work?" into a
  screenshot instead of a claim. Never remove it.
- **Image tags use `<+pipeline.sequenceId>`, never `latest`.** The CD stage consumes the
  same expression, which is what wires the two stages together. `latest` makes rollouts
  non-deterministic and breaks the CI→CD seam.
- **`k8s/values.yaml` carries `image: <+artifact.image>`** so Harness resolves the
  artifact at runtime. Keys in `values.yaml` must match the `{{.Values.x}}` references
  in the manifests.
- Manifests are Go-templated per the Harness K8s manifest convention — not Helm charts.

---

## 6. Verification gates (this project's equivalent of tests)

There is almost no application logic here, so **"run the tests" means "prove the
infrastructure claim with a command."** Never report a phase complete without its gate
output. Each gate is also a screenshot for the notes.

| Gate | Command / check | Passing |
|---|---|---|
| G1 cluster | `kubectl get nodes` | all `Ready` |
| G2 delegate | `kubectl get pods -n harness-delegate-ng` + Harness UI | `Running` **and** Connected |
| G3 connectors | Each connector's **Test Connection** | green, all three |
| G4 CI | Pipeline run + registry listing | green **and** tag present |
| G5 CD dev | `kubectl get pods -n dev` | `Running`, correct image tag |
| G6 reachable | `curl https://webomoney-dev.<DOMAIN>/api/version` | HTTP 200, expected version string, **trusted** certificate |
| G7 loop | Bump version → push → re-run → re-curl | new version served |
| G8 templates | Pipeline shows linked-template indicators at all three tiers | referenced, not inlined |
| G9 promotion | Pipeline pauses at the approval step; prod deploys only after approval | gate actually blocks |
| ~~G10 canary~~ | *Descoped in #3* — both environments deploy rolling | n/a |
| G11 overrides | dev and prod differ per their env values files | replica counts differ as configured |
| G12 as-code | `.harness/` YAML in the repo matches what the console shows | bidirectional sync working |
| G13 rollback | Force a failed deploy | Harness rolls back automatically; prior version still serving |
| G14 resume | `./scripts/lab-up.sh` after a park | exits 0 **and** both public URLs return 200 |

**Never claim a gate passed without having run it.** If a gate is red, stop — do not
proceed to the next phase.

---

## 7. Workflow — issues, branches, PRs

`main` is protected by a ruleset: pull requests required, no force-push, no deletion.
Repository admins can bypass, so you are never locked out — but bypassing is for
emergencies, not for convenience.

**Every unit of work starts as a GitHub issue** with acceptance criteria, and ends when
those criteria are checked off. The issue is the source of truth for scope; the checkbox
state is the live completion ledger, so tick them as work merges rather than batching to
the end.

```
issue  →  branch  →  commits  →  PR (closes #N)  →  merge  →  tick criteria
```

- **Branch naming:** `feat/`, `fix/`, `docs/`, `chore/` + short slug
- **Commit and PR titles:** conventional-commit prefix
- **PR body:** `Closes #N` so the issue closes on merge
- **Before every push:** run the PII scan from §3 — this repo is public

The first thirteen commits predate this and went directly to `main`. That was a process
gap, not a precedent.

---

## 8. Working style

The `wizard` skill (`/wizard`) and its agent roster are installed under `.claude/`. It
was written for application feature work, so **adapt it to this repo rather than applying
it literally:**

- **Phase 3 (TDD/RED-GREEN)** maps to the §6 verification gates. Assert the gate *before*
  building the thing that satisfies it — state the expected output, then produce it.
- **Phase 8 (PR review cycle)** is optional here. This is a solo take-home with no review
  bot; commit directly to `main` unless a change is genuinely worth reviewing in isolation.
- **The full agent ensemble is usually overkill.** Most work here is Band 1 (single domain,
  few criteria). Don't pay the multi-agent tax for a `deployment.yaml` edit.
- **The adversarial mindset does carry over fully** — "what if the delegate can't reach
  Harness?", "what if the tag doesn't resolve?", "what if the LoadBalancer never gets an
  IP?" — those are exactly the failure modes this lab is built to surface.

### Non-negotiables

- **Never fabricate a result.** Not a gate, not a screenshot, not a pipeline status. If
  something wasn't run, say so. A submission containing an invented success is
  disqualifying in a way a broken pipeline is not.
- **Log breakage as it happens**, into `docs/LAB-NOTES.md`, while the error text is still
  on screen.
- **Cloud resources cost real money.** The GKE cluster is the only recurring cost; it must
  be deleted once evidence is captured. Never create resources beyond what a gate needs.
- **Console work is the human's.** Harness configuration happens in a browser. Produce
  exact click-paths and paste-ready values; do not claim UI state you cannot observe.
