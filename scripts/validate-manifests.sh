#!/usr/bin/env bash
#
# Catch values/manifest drift locally, before Harness does.
#
# Harness renders k8s/*.yaml as Go templates against the layered values files.
# A {{.Values.x}} with no matching key does not fail at commit time — it fails
# mid-deploy, several minutes into a pipeline run, with a rendering error that
# reads like a Harness problem. This check makes that failure immediate and free.
#
# Two directions are checked, because both are real failure modes:
#   1. every {{.Values.X}} referenced by a manifest exists in the base values
#   2. every key in an environment override corresponds to a base key — an
#      override key with no base counterpart is a typo that silently does nothing

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MANIFESTS="k8s/deployment.yaml k8s/service.yaml k8s/ingress.yaml"
BASE="k8s/values.yaml"
fail=0

echo "==> Checking manifest references against ${BASE}"
# Comments are stripped first: documentation often contains an illustrative
# {{.Values.x}} that is not a real reference.
refs=$(sed 's/#.*//' $MANIFESTS | grep -ho '{{\.Values\.[a-zA-Z0-9_]*}}' \
       | sed 's/{{\.Values\.//; s/}}//' | sort -u)

while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  if grep -qE "^${ref}:" "$BASE"; then
    printf '    ok       %s\n' "$ref"
  else
    printf '    MISSING  %s  <- referenced by a manifest, absent from %s\n' "$ref" "$BASE"
    fail=1
  fi
done <<< "$refs"

echo "==> Checking environment overrides are a subset of base keys"
for f in k8s/env/*/values.yaml; do
  [ -e "$f" ] || continue
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    if grep -qE "^${key}:" "$BASE"; then
      printf '    ok       %-16s (%s)\n' "$key" "$f"
    else
      printf '    ORPHAN   %-16s (%s) <- no base key; this override does nothing\n' "$key" "$f"
      fail=1
    fi
  done <<< "$(sed 's/#.*//' "$f" | grep -oE '^[a-zA-Z0-9_]+:' | cut -d: -f1)"
done

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ All template references resolve."
else
  echo "❌ Unresolved references — fix before pushing; this would fail mid-deploy."
fi
exit "$fail"
