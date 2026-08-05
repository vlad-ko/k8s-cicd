#!/usr/bin/env bash
# Shared configuration for the lab lifecycle scripts.
#
# Values are read from the environment so no account identifier is ever committed.
# Create scripts/lab.env (gitignored) with your real values:
#
#   GCP_PROJECT_ID=your-project-id
#
# Everything else has a sensible default and rarely needs overriding.

set -euo pipefail

# Load local overrides if present.
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${_here}/lab.env" ] && . "${_here}/lab.env"

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID (put it in scripts/lab.env)}"

ZONE="${ZONE:-us-central1-a}"
REGION="${REGION:-${ZONE%-*}}"
CLUSTER="${CLUSTER:-harness-lab}"
NODE_POOL="${NODE_POOL:-default-pool}"
NODE_COUNT="${NODE_COUNT:-2}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"
ROUTER="${ROUTER:-harness-lab-router}"
NAT="${NAT:-harness-lab-nat}"

GC="gcloud --project=${GCP_PROJECT_ID}"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !! \033[0m%s\n' "$1"; }
ok()   { printf '\033[0;32m ✓ \033[0m%s\n' "$1"; }

# The nodes cannot hold external IPs (inherited org policy denies it), so all
# outbound traffic — including the delegate's connection to Harness — depends on
# Cloud NAT existing. Both lifecycle scripts treat it as part of the cluster.
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

# The control plane allow-list is pinned to a single residential IP, which changes.
# Re-authorizing on every start-up avoids a confusing "kubectl times out" session.
# Note curl -4: this network returns an IPv6 address by default, and GKE's
# authorized-networks field accepts IPv4 CIDR only.
authorize_current_ip() {
  local ip
  ip="$(curl -4 -s --max-time 10 https://ifconfig.me || true)"
  case "$ip" in
    *.*.*.*) ;;
    *) warn "Could not determine an IPv4 address; skipping authorized-networks update"; return 0 ;;
  esac
  log "Authorizing current IPv4 (…${ip##*.}) for control plane access"
  $GC container clusters update "$CLUSTER" --zone="$ZONE" \
    --enable-master-authorized-networks \
    --master-authorized-networks="${ip}/32" >/dev/null
  ok "Control plane reachable from this machine"
}
