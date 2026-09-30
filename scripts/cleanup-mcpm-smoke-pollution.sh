#!/usr/bin/env bash
# Clean orphan `agentbrew-test-smoke-*` entries from the user's global mcpm
# registry (`~/.config/mcpm/servers.json`).
#
# Why this exists:
#   The `delegateMcpNew` smoke test in `src/sync/mcp-delegate.test.ts`
#   registers a pid-unique `agentbrew-test-smoke-<pid>` entry via the real
#   mcpm binary because the helper has no mock-friendly seam and mcpm doesn't
#   honor AGENTBREW_MCPM_CONFIG_DIR. PR #<this> adds an `afterAll` teardown to
#   the test so future runs clean up after themselves, but historical orphans
#   from previous failed teardowns still litter the registry.
#
# This script is the one-shot remediation. Idempotent — running it on a clean
# registry is a no-op. Safe to run anytime; only entries matching the
# `agentbrew-test-smoke-<digits>` pattern are touched.
#
# Closes P0 `cleanup-mcpm-test-smoke-pollution`.

set -euo pipefail

if ! command -v mcpm >/dev/null 2>&1; then
  echo "mcpm not on PATH — nothing to clean." >&2
  exit 0
fi

# mcpm prints noisy deprecation warnings; trim them out of the listing.
orphans=$(mcpm ls 2>/dev/null | grep -oE 'agentbrew-test-smoke-[0-9]+' || true)

if [ -z "$orphans" ]; then
  echo "✓ No orphan agentbrew-test-smoke-* entries in mcpm global config."
  exit 0
fi

count=$(printf '%s\n' "$orphans" | wc -l | tr -d ' ')
echo "Found $count orphan entries — cleaning..."

removed=0
failed=0
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if mcpm uninstall "$name" --force >/dev/null 2>&1; then
    echo "  ✓ removed: $name"
    removed=$((removed + 1))
  else
    echo "  ⚠ failed: $name (retry later — mcpm may have crashed)" >&2
    failed=$((failed + 1))
  fi
done <<< "$orphans"

echo ""
echo "Summary: $removed removed, $failed failed."

# Verify post-state — informational, not a hard gate (some failures are
# benign, e.g. mcpm "Too many open files" mid-loop).
remaining=$(mcpm ls 2>/dev/null | grep -c 'agentbrew-test-smoke' || echo 0)
if [ "$remaining" -eq 0 ]; then
  echo "✓ mcpm global config has zero agentbrew-test-smoke-* entries."
else
  echo "⚠ $remaining entries still present — re-run this script to retry."
  exit 1
fi
