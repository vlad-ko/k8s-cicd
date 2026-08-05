#!/usr/bin/env bash
#
# Park the lab between sessions.
#
# On Autopilot there are no node pools to scale — you scale the *workloads* to
# zero, which drives your billable pod requests to zero. Removing the
# LoadBalancer Service and the Cloud NAT gateway takes out the two remaining
# hourly charges that persist with no pods running.
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

# Released first: a LoadBalancer forwarding rule bills hourly and would otherwise
# linger with no pods behind it.
for ns in $APP_NAMESPACES; do
  if kubectl get svc "$APP_NAME" -n "$ns" >/dev/null 2>&1; then
    log "Removing LoadBalancer Service in ${ns}"
    kubectl delete svc "$APP_NAME" -n "$ns" --wait=false >/dev/null 2>&1 || true
  fi
done

log "Scaling workloads to zero (drives billable pod requests to zero)"
for ns in $APP_NAMESPACES; do scale_ns "$ns" 0; done
scale_ns "$DELEGATE_NS" 0

remove_nat

echo
ok "Lab parked."
warn "The Harness delegate will report DISCONNECTED while scaled to zero."
warn "This is expected — ./lab-up.sh brings it back."
echo
log "Still billing (small): the Autopilot cluster fee, if not covered by the GKE free tier."
log "To stop all charges permanently:"
log "  gcloud container clusters delete ${CLUSTER} --location=${LOCATION}"
