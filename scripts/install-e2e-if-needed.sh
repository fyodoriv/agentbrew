#!/usr/bin/env bash
# Run the one-step install e2e (real-e2e/scenarios/us24-one-step-install)
# only when a change can affect the install. Other diffs add 0 s.
#   fast (built CLI, real init/status/lint, real restore): about 60 s
#   cold (copy + npm ci + build + link, as a new clone):   about 45 s
#   pack (npm pack + global install; hooks and rules match a clone): about 10 s
#
# Usage: bash scripts/install-e2e-if-needed.sh [base-ref]   (default: origin/main)
#        printf '%s\n' paths | bash scripts/install-e2e-if-needed.sh --stdin --dry-run
# --dry-run prints the decision (fast, cold, pack, or skip) and runs nothing.
#
# <!-- scope: human-approved owner goal 2026-10-16: keep the one-step install e2e-tested cheaply -->
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

FAST_TRIGGERS='^(scripts/install\.sh|INSTALL\.md|src/init[^/]*\.ts|src/shell-hook\.ts|src/sync/(auto-sync|launchagent)\.ts|src/lint\.ts|src/health\.ts|src/cli\.ts|real-e2e/scenarios/us24-one-step-install\.test\.ts|scripts/install-e2e-if-needed\.sh)$'
COLD_TRIGGERS='^(scripts/install\.sh|package\.json|package-lock\.json|tsup\.config\.ts|real-e2e/scenarios/us24-one-step-install\.test\.ts)$'
PACK_TRIGGERS='^(package\.json|tsup\.config\.ts|hooks/manifest\.yaml|templates/rules/.*|src/core/repo-root\.ts|src/sync/(hooks-sync|catalog-template-rules)\.ts|real-e2e/scenarios/npm-package-hooks\.test\.ts)$'

dry_run=0
from_stdin=0
base_ref="origin/main"
for arg in "$@"; do
  case "$arg" in
  --dry-run) dry_run=1 ;;
  --stdin) from_stdin=1 ;;
  *) base_ref="$arg" ;;
  esac
done

if [[ "$from_stdin" -eq 1 ]]; then
  changed="$(cat)"
else
  base="$(git merge-base HEAD "$base_ref" 2>/dev/null || echo HEAD)"
  changed="$({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)"
fi

fast=0
cold=0
pack=0
grep -qE "$FAST_TRIGGERS" <<<"$changed" && fast=1
grep -qE "$COLD_TRIGGERS" <<<"$changed" && cold=1
grep -qE "$PACK_TRIGGERS" <<<"$changed" && pack=1

if [[ "$fast" -eq 0 && "$cold" -eq 0 && "$pack" -eq 0 ]]; then
  echo "install e2e: skip (no install path changed)"
  exit 0
fi
[[ "$fast" -eq 1 ]] && echo "install e2e: fast"
[[ "$cold" -eq 1 ]] && echo "install e2e: cold"
[[ "$pack" -eq 1 ]] && echo "install e2e: pack"
[[ "$dry_run" -eq 1 ]] && exit 0

scenario=real-e2e/scenarios/us24-one-step-install.test.ts
if [[ "$fast" -eq 1 ]]; then
  npx vitest run --config vitest.real-e2e.config.ts "$scenario"
fi
if [[ "$cold" -eq 1 ]]; then
  E2E_COLD=1 npx vitest run --config vitest.real-e2e.config.ts "$scenario"
fi
if [[ "$pack" -eq 1 ]]; then
  npx vitest run --config vitest.real-e2e.config.ts real-e2e/scenarios/npm-package-hooks.test.ts
fi
