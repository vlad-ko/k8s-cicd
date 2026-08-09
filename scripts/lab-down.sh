#!/usr/bin/env bash
#
# Park the lab between sessions.
#
# On Autopilot there are no node pools to scale — you scale the *workloads* to
# zero, which drives your billable pod requests to zero.
#
# Park scales; it never deletes. See the invariant in lab-env.sh: an earlier
# version of this script deleted the per-environment Service, which lab-up.sh has
# no way to recreate, and resume came back to an Ingress with no backend while
# both scripts reported success (Finding 19).
#
# What this does NOT do, despite appearances: empty the cluster of nodes.
# Autopilot keeps nodes alive to run kube-system, so `kubectl get nodes` still
# shows capacity after parking. Under Autopilot's pod-request billing those
# system nodes are Google's cost, not yours — the thing that actually falls to
# zero is what YOUR pods request. Verified: parking with no workloads deployed
# left two nodes Ready.
#
# The cluster object survives, so namespaces, the installed delegate, and every
# Harness-side connector and pipeline stay valid; ./lab-up.sh restores it.
#
# Why this is safer than the Standard-cluster equivalent: scaling a node pool to
# zero releases VM capacity that is NOT reserved for you, and the zone may have
# none left when you return (Finding 7). Autopilot re-requests capacity per pod
# from a much larger managed pool, so resuming is far less likely to strand you.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lab-env.sh"

log "Parking cluster ${CLUSTER}"

refresh_kubeconfig

log "Scaling workloads to zero (drives billable pod requests to zero)"
for ns in $APP_NAMESPACES; do scale_ns "$ns" 0; done
scale_ns "$DELEGATE_NS" 0

# Otherwise it spawns a pod every hour against a delegate that is not there.
log "Suspending the delegate upgrader"
set_upgrader true

# Cloud NAT deliberately stays up — see remove_nat() in lab-env.sh for why.

echo
ok "Lab parked."
warn "The Harness delegate will report DISCONNECTED while scaled to zero."
warn "Both app URLs will return 503 until ./lab-up.sh restores the pods."
warn "This is expected."

report_residual

echo
log "To stop all charges permanently (teardown, not parking — see issue #8):"
log "  gcloud container clusters delete ${CLUSTER} --location=${LOCATION}"
log "  gcloud compute routers delete ${ROUTER} --region=${REGION}"
log "  gcloud compute addresses delete webo-ingress-ip --region=${REGION}"
