#!/usr/bin/env bash
#
# Park the lab between sessions.
#
# Scales the node pool to zero and removes the NAT gateway, which together
# eliminate essentially all recurring cost. The cluster object itself survives,
# so namespaces, the installed delegate, and every Harness-side connector and
# pipeline keep working — bringing it back is ./lab-up.sh, not a rebuild.
#
# What this does NOT do: delete the cluster. Use `make destroy` (or the teardown
# command in the notes) when the lab is finished for good.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lab-env.sh"

log "Parking cluster ${CLUSTER}"

# Deleting the LoadBalancer Service first releases its forwarding rule, which
# bills hourly and would otherwise linger with no pods behind it. The Deployment
# is left in place so the next deploy is a normal rollout.
if kubectl get svc harness-lab-app -n dev >/dev/null 2>&1; then
  log "Removing LoadBalancer Service (releases its forwarding rule)"
  kubectl delete svc harness-lab-app -n dev --wait=false >/dev/null 2>&1 || true
fi

log "Scaling ${NODE_POOL} to 0 nodes (deletes node VMs and their boot disks)"
$GC container clusters resize "$CLUSTER" --zone="$ZONE" \
  --node-pool="$NODE_POOL" --num-nodes=0 --quiet

remove_nat

echo
ok "Lab parked."
warn "The Harness delegate will report DISCONNECTED while nodes are at zero."
warn "This is expected — it reschedules automatically on ./lab-up.sh."
echo
log "Still billing (small): cluster management fee, if not covered by the GKE free tier."
log "To stop all charges permanently: gcloud container clusters delete ${CLUSTER} --zone=${ZONE}"
