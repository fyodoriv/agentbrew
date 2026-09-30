#!/usr/bin/env bash
# measure-context-budget.sh — thin wrapper for cron/launchd; logic lives in agentbrew.
set -euo pipefail

QUICK_ARGS=(--skip-ccusage)
if agentbrew measure context --help 2>/dev/null | grep -q -- '--quick'; then
  QUICK_ARGS=(--quick)
fi

if command -v agentbrew >/dev/null 2>&1; then
  exec agentbrew measure context "${QUICK_ARGS[@]}" "$@"
fi

if [[ -x "./dist/cli.js" ]]; then
  exec node ./dist/cli.js measure context "$@"
fi

if [[ -x "./node_modules/.bin/tsx" ]]; then
  exec ./node_modules/.bin/tsx src/cli.ts measure context "$@"
fi

echo "agentbrew measure context: agentbrew CLI not found (install or run from agentbrew repo after npm run build)" >&2
exit 1
