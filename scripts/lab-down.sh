#!/usr/bin/env bash
#
# Park the lab between sessions.
#
# On Autopilot there are no nodes to scale down directly — you scale the
# *workloads* to zero and Autopilot reclaims the nodes underneath. Removing the
# LoadBalancer Service and the Cloud NAT gateway takes out the two remaining
# hourly charges that persist with no pods running.
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
  if kubectl get svc harness-lab-app -n "$ns" >/dev/null 2>&1; then
    log "Removing LoadBalancer Service in ${ns}"
    kubectl delete svc harness-lab-app -n "$ns" --wait=false >/dev/null 2>&1 || true
  fi
done

log "Scaling workloads to zero (Autopilot then reclaims the nodes)"
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
