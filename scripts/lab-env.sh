#!/usr/bin/env bash
# Shared configuration for the lab lifecycle scripts.
#
# Values are read from the environment so no account identifier is ever committed.
# Create scripts/lab.env (gitignored) with your real values:
#
#   GCP_PROJECT_ID=your-project-id
#
# Everything else has a sensible default and rarely needs overriding.
#
# ---------------------------------------------------------------------------
# The cluster is GKE **Autopilot**, which changes the lifecycle model.
#
# There are no node pools, so there is nothing to resize. Autopilot provisions
# nodes to fit the pods you ask for and reclaims them when the pods go away.
# Parking is therefore "scale the workloads to zero" and the node cost follows,
# rather than "surrender the nodes and hope the capacity is still there later" —
# which is precisely how the Standard cluster stranded us (see Finding 7).
# ---------------------------------------------------------------------------

set -euo pipefail

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${_here}/lab.env" ] && . "${_here}/lab.env"

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID (put it in scripts/lab.env)}"

# Autopilot clusters are always regional. --location works for regional and
# zonal alike, so the scripts do not care which this is.
LOCATION="${LOCATION:-us-central1}"
REGION="${REGION:-us-central1}"
CLUSTER="${CLUSTER:-harness-lab-auto}"
ROUTER="${ROUTER:-harness-lab-router}"
NAT="${NAT:-harness-lab-nat}"

APP_NAME="${APP_NAME:-webo-money-world}"
APP_NAMESPACES="${APP_NAMESPACES:-dev prod}"
DELEGATE_NS="${DELEGATE_NS:-harness-delegate-ng}"

GC="gcloud --project=${GCP_PROJECT_ID}"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !! \033[0m%s\n' "$1"; }
ok()   { printf '\033[0;32m ✓ \033[0m%s\n' "$1"; }

# Nodes cannot hold external IPs (inherited org policy denies it), so all
# outbound traffic — including the delegate's connection to Harness — depends on
# Cloud NAT. It is regional, so it covers every zone Autopilot might place nodes
# in. Both lifecycle scripts treat it as part of the cluster.
ensure_nat() {
  if ! $GC compute routers describe "$ROUTER" --region="$REGION" >/dev/null 2>&1; then
    log "Creating Cloud Router ${ROUTER}"
    $GC compute routers create "$ROUTER" --network=default --region="$REGION" >/dev/null
  fi
  if ! $GC compute routers nats describe "$NAT" --router="$ROUTER" --region="$REGION" >/dev/null 2>&1; then
    log "Creating Cloud NAT ${NAT}"
    $GC compute routers nats create "$NAT" --router="$ROUTER" --region="$REGION" \
      --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges >/dev/null
  fi
  ok "Cloud NAT ready"
}

remove_nat() {
  if $GC compute routers describe "$ROUTER" --region="$REGION" >/dev/null 2>&1; then
    log "Deleting Cloud Router ${ROUTER} (removes NAT gateway charges)"
    $GC compute routers delete "$ROUTER" --region="$REGION" --quiet >/dev/null
  fi
  ok "Cloud NAT removed"
}

# Only meaningful if the cluster restricts control-plane access. Autopilot may or
# may not enable authorized networks depending on how it was created, so this is
# a no-op when the allow-list is not in use rather than an error.
#
# curl -4 is deliberate: this network answers with IPv6 by default, and GKE's
# authorized-networks field accepts IPv4 CIDR only.
authorize_current_ip() {
  local enabled ip
  enabled=$($GC container clusters describe "$CLUSTER" --location="$LOCATION" \
              --format='value(masterAuthorizedNetworksConfig.enabled)' 2>/dev/null || true)
  if [ "$enabled" != "True" ]; then
    ok "Control plane is not restricted by authorized networks; nothing to do"
    return 0
  fi
  ip="$(curl -4 -s --max-time 10 https://ifconfig.me || true)"
  case "$ip" in
    *.*.*.*) ;;
    *) warn "Could not determine an IPv4 address; skipping authorized-networks update"; return 0 ;;
  esac
  log "Authorizing current IPv4 (…${ip##*.}) for control plane access"
  $GC container clusters update "$CLUSTER" --location="$LOCATION" \
    --enable-master-authorized-networks \
    --master-authorized-networks="${ip}/32" >/dev/null
  ok "Control plane reachable from this machine"
}

refresh_kubeconfig() {
  log "Refreshing kubeconfig"
  $GC container clusters get-credentials "$CLUSTER" --location="$LOCATION" >/dev/null 2>&1
}

# Scale every Deployment and StatefulSet in a namespace. Both kinds are covered
# because the Harness delegate has shipped as each at different versions, and
# guessing wrong would silently leave it running.
scale_ns() {
  local ns="$1" replicas="$2"
  kubectl get ns "$ns" >/dev/null 2>&1 || return 0
  local targets
  targets=$(kubectl get deploy,statefulset -n "$ns" -o name 2>/dev/null || true)
  [ -z "$targets" ] && return 0
  # shellcheck disable=SC2086
  kubectl scale --replicas="$replicas" -n "$ns" $targets >/dev/null 2>&1 || true
  printf '    %s -> %s replicas\n' "$ns" "$replicas"
}

# Replica counts live in the environment values files, so resume restores what
# the deployment actually asks for rather than a number duplicated in this script.
replicas_for() {
  local env="$1" f="${_here}/../k8s/env/${env}/values.yaml"
  [ -f "$f" ] && sed 's/#.*//' "$f" | awk '/^replicas:/{print $2; exit}' || echo 1
}
