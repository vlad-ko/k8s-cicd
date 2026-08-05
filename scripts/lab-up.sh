#!/usr/bin/env bash
#
# Resume the lab after ./lab-down.sh.
#
# Restores node capacity, recreates the egress path, and re-authorizes this
# machine against the control plane. Ordering matters: NAT must exist before the
# nodes come up, or the delegate boots with no route to Harness and sits there
# looking broken for reasons that have nothing to do with Harness.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lab-env.sh"

log "Resuming cluster ${CLUSTER}"

# Egress first — see note above.
ensure_nat

resize_pool "$NODE_COUNT"

authorize_current_ip

log "Refreshing kubeconfig"
$GC container clusters get-credentials "$CLUSTER" --zone="$ZONE" >/dev/null 2>&1

log "Waiting for nodes to become Ready"
kubectl wait --for=condition=Ready nodes --all --timeout=300s >/dev/null

echo
kubectl get nodes
echo

# The delegate is the thing most likely to still be settling, and it is also the
# thing whose absence breaks CD. Report it explicitly rather than leaving the
# user to discover it mid-pipeline.
if kubectl get ns harness-delegate-ng >/dev/null 2>&1; then
  log "Delegate pods:"
  kubectl get pods -n harness-delegate-ng 2>/dev/null || true
  warn "Allow a minute or two for the delegate to re-register as CONNECTED in Harness."
fi

ok "Lab resumed."
