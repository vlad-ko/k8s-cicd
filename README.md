# Harness Implementation Engineering Lab

An end-to-end CI/CD implementation built with [Harness](https://harness.io): source code
is built by **Harness CI** on hosted infrastructure, published as a container image to a
public registry, and deployed to a **Kubernetes** cluster by **Harness CD** through an
in-cluster Harness Delegate — with a reusable step **template** driving the build.

> **Status:** in progress. See [`docs/LAB-NOTES.md`](docs/LAB-NOTES.md) for the build log,
> evidence, and the record of what broke and how it was diagnosed.

---

## Architecture

```
   GitHub  ──push──▶  Harness CI  (Harness Cloud, hosted runners — no delegate)
                          │  mvn package  ·  build + push image
                          ▼
                   Docker Hub (public)   tag = <+pipeline.sequenceId>
                          │
                          ▼
                   Harness CD  ──▶  Harness Delegate  ──▶  GKE cluster
                                     (in-cluster)            namespace: dev
                                                             Service: LoadBalancer
```

The split is the point: **CI needs no delegate** because it runs on Harness-hosted
infrastructure, while **CD does**, because it has to reach a Kubernetes API server that
Harness cannot address directly. The delegate is the outbound-only agent that closes
that gap.

## Repository layout

| Path | Contents |
|---|---|
| `app/` | Spring Boot application + `Dockerfile` — one endpoint returning a version string |
| `k8s/` | Kubernetes manifests (`deployment.yaml`, `service.yaml`) and `values.yaml` |
| `docs/LAB-NOTES.md` | The lab write-up: steps, evidence, failures, diagnoses, references |
| `docs/screenshots/` | Redacted screenshots backing each verification gate |
| `CLAUDE.md` | Working conventions for AI-assisted development in this repo |
| `.claude/` | [claude-wizard](https://github.com/vlad-ko/claude-wizard) skill + agent roster |

## Design decisions

- **Image tags are `<+pipeline.sequenceId>`, never `latest`.** The CD stage resolves the
  same expression, which is what wires the two stages together deterministically.
- **The app returns a version string.** Bumping it and re-running proves the full CI→CD
  loop visually, rather than by assertion.
- **`Service` is `type: LoadBalancer`.** The cluster issues a real external IP, so
  verification is a genuine HTTP request rather than a local port-forward.
- **The cluster is public, not private.** A private cluster has no egress by default, so
  the delegate installs cleanly and then never connects — a deliberately avoided trap.

## Reproducing this

Configuration values are parameterized; no account identifiers, cluster endpoints, or
credentials are committed. Substitute your own for `<GCP_PROJECT_ID>`, `<CLUSTER_NAME>`,
`<ZONE>`, and `<REGISTRY_USER>`, and supply credentials through the Harness secret
manager rather than in-repo. `docs/LAB-NOTES.md` carries the full sequence.

## References

- [Harness CI — Java quickstart](https://developer.harness.io/tutorials/ci-pipelines/build/java)
- [Harness Cloud build infrastructure](https://developer.harness.io/docs/continuous-integration/use-ci/set-up-build-infrastructure/use-harness-cloud-build-infrastructure/)
- [Harness CD — Kubernetes manifest quickstart](https://developer.harness.io/tutorials/cd-pipelines/kubernetes/manifest)
- [Harness Templates](https://developer.harness.io/docs/category/templates)
