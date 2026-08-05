#!/usr/bin/env bash
#
# Resume the lab after ./lab-down.sh.
#
# Restores the egress path, then the workloads. Ordering matters: NAT must exist
# before the delegate starts, or it boots with no route to Harness and sits there
# looking broken for reasons that have nothing to do with Harness — the same trap
# as Finding 1.
#
# Application replica counts are restored from k8s/env/<env>/values.yaml rather
# than hard-coded here, so this script cannot drift from what the deployment
# actually declares.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lab-env.sh"

log "Resuming cluster ${CLUSTER}"

# Egress first — see note above.
ensure_nat

authorize_current_ip
refresh_kubeconfig

log "Restoring the delegate"
scale_ns "$DELEGATE_NS" 1

log "Restoring application workloads"
for ns in $APP_NAMESPACES; do
  scale_ns "$ns" "$(replicas_for "$ns")"
done

# Autopilot has to provision nodes to fit the restored pods, so the first pods
# stay Pending for a minute or two. That is normal here and not a scheduling
# failure — worth surfacing so it is not misread as one.
log "Waiting for pods to schedule (Autopilot provisions nodes on demand)"
kubectl wait --for=condition=Ready pods --all -n "$DELEGATE_NS" --timeout=300s >/dev/null 2>&1 \
  || warn "Delegate pods not Ready yet — check 'kubectl get pods -n ${DELEGATE_NS}'"

echo
kubectl get nodes 2>/dev/null || warn "No nodes yet; Autopilot provisions them as pods are scheduled"
echo
for ns in $DELEGATE_NS $APP_NAMESPACES; do
  kubectl get ns "$ns" >/dev/null 2>&1 || continue
  echo "--- $ns ---"
  kubectl get pods -n "$ns" 2>/dev/null || true
done

echo
warn "Allow a minute or two for the delegate to re-register as CONNECTED in Harness."
ok "Lab resumed."
