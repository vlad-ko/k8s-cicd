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
#
# ---------------------------------------------------------------------------
# THE INVARIANT (see Finding 19)
#
#   lab-down.sh may only do things lab-up.sh can undo.
#
# The first version of these scripts broke it. lab-down.sh deleted the per-
# environment LoadBalancer Service, which was correct when the app owned its own
# LoadBalancer. After the ingress migration those Services became ClusterIP
# behind a shared Ingress — and `kubectl get svc` succeeds for a ClusterIP just
# as happily, so the delete kept firing against a resource lab-up.sh has no idea
# how to recreate. Park then resume returned two Ingresses with no backend, 503,
# and both scripts reporting success.
#
# Scaling is reversible; deleting is not. Park by scaling only.
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

# The delegate ships a CronJob that self-upgrades it hourly. Left running against
# a parked delegate it spawns a pod every hour forever, and on resume it can pull
# a newer delegate image than the one Harness registered. Park suspends it.
UPGRADER_CRONJOB="${UPGRADER_CRONJOB:-webo-moneyworld-upgrader-job}"

# Namespaces holding the ingress path: the nginx controller that owns the single
# LoadBalancer, and cert-manager which issued the Let's Encrypt certificates.
#
# These are deliberately NOT parked. DNS, the forwarding rule, the reserved
# static IP and the certificates are wired to each other, and rebuilding that
# chain costs a fresh ACME issuance against Let's Encrypt's rate limits. Parking
# them would save roughly $0.60/day and risk the demo. Listed here so the scripts
# can report what they left up rather than leaving it a surprise.
PLATFORM_NAMESPACES="${PLATFORM_NAMESPACES:-ingress-nginx cert-manager}"

# Used only to verify on resume that the app actually serves.
#
# Derived from k8s/values.yaml rather than restated here, for the same reason
# replicas_for() reads the env values files: a second copy is a second thing to
# drift, and drift between a script and the architecture it manages is exactly
# what Finding 19 is about. It also keeps the domain out of this file.
#
#   host: webomoney-<+env.identifier>.example.com   ->   example.com
#
# The Harness expression is stripped FIRST. `<+env.identifier>` contains a dot,
# so splitting on the first dot without removing it yields "identifier>.example.com".
# Caught by testing the derivation instead of assuming it.
APP_DOMAIN="${APP_DOMAIN:-$(
  awk '/^host:/{gsub(/<\+[^>]*>/, "", $2); sub(/^[^.]*\./, "", $2); print $2; exit}' \
    "${_here}/../k8s/values.yaml" 2>/dev/null
)}"
: "${APP_DOMAIN:?Could not derive APP_DOMAIN from k8s/values.yaml; set it in scripts/lab.env}"

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

# For teardown, NOT for parking.
#
# Parking leaves ingress-nginx and cert-manager running, and Autopilot
# consolidates nodes the moment the app pods go away — so those pods get
# rescheduled onto a different node and have to re-pull their images from
# registry.k8s.io and quay.io. With no NAT there is no route out, and they sit in
# ImagePullBackOff until someone looks. Removing NAT saves about $1/day and buys
# a silently broken ingress path. Park keeps it.
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
  # Declared on separate lines deliberately. `local a="$1" b="${a}"` marks both
  # names local before assigning either, so the second expansion sees an unset
  # variable and `set -u` aborts the script — which is exactly how the first real
  # lab-up.sh run failed to restore replica counts, silently, while reporting
  # success everywhere else.
  local envname="$1"
  local f="${_here}/../k8s/env/${envname}/values.yaml"
  local n=""
  [ -f "$f" ] && n="$(sed 's/#.*//' "$f" | awk '/^replicas:/{print $2; exit}')"
  # Fall back to 1 rather than emitting nothing: an empty value would make the
  # caller run `kubectl scale --replicas=` and fail obscurely.
  printf '%s' "${n:-1}"
}

# suspend=true parks it, suspend=false resumes. An absent CronJob is not an error
# — the delegate has shipped without one at some versions.
set_upgrader() {
  local suspend="$1"
  kubectl get cronjob "$UPGRADER_CRONJOB" -n "$DELEGATE_NS" >/dev/null 2>&1 || return 0
  kubectl patch cronjob "$UPGRADER_CRONJOB" -n "$DELEGATE_NS" \
    -p "{\"spec\":{\"suspend\":${suspend}}}" >/dev/null 2>&1 || true
  printf '    upgrader CronJob suspend=%s\n' "$suspend"
}

# Report what park deliberately left running, so the residual is never a surprise
# when the bill arrives.
report_residual() {
  echo
  log "Left running on purpose (the ingress path — see Finding 19):"
  local n
  for ns in $PLATFORM_NAMESPACES; do
    kubectl get ns "$ns" >/dev/null 2>&1 || continue
    n=$(kubectl get deploy -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    printf '    %-14s %s deployment(s)\n' "$ns" "$n"
  done
  printf '    %-14s %s\n' "Cloud NAT" "egress for the above"
  printf '    %-14s %s\n' "static IP" "reserved, still bound to the LoadBalancer"
  echo
  log "Residual ≈ \$1.50/day (forwarding rule, static IP, NAT, cluster fee)."
  log "Certificates and DNS are untouched, so resume needs no re-issuance."
}

# The check lab-up.sh was missing.
#
# Pod readiness proves pods are running; it says nothing about whether the
# Ingress still routes to them. That gap is precisely what let the Service-
# deletion bug report success. This asserts what is actually being claimed: the
# public URL serves the app over TLS.
#
# Returns non-zero if any host fails, so the caller can exit non-zero rather than
# printing a cheerful summary over a broken lab.
verify_reachable() {
  local failed=0 host code
  for ns in $APP_NAMESPACES; do
    host="webomoney-${ns}.${APP_DOMAIN}"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${host}/api/version" || echo 000)"
    if [ "$code" = "200" ]; then
      ok "https://${host} → 200"
    else
      warn "https://${host} → ${code} (expected 200)"
      failed=1
    fi
  done
  return "$failed"
}
