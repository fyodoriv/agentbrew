#!/usr/bin/env bash
# Action parity: every {{NAME}} action runs three ways (CLI, agents, UI). Shared rule
# "Every action through CLI, agent, and UI". Exit 1 when an action misses a path.
# FILL: replace UI_CATALOG with the command that lists the actions your UI offers (for example
# `curl -s localhost:<port>/api/actions | jq -r '.actions[].name'`), then delete this FILL line.
set -euo pipefail
if ! command -v {{NAME}} >/dev/null 2>&1 || ! {{NAME}} actions --json >/dev/null 2>&1; then
  echo "SKIP: {{NAME}} has no 'actions --json' yet (add it with the first command)"; exit 0
fi
agent="$({{NAME}} actions --json | jq -r '.[].name' | sort)"
ui="$(${UI_CATALOG:-{{NAME}} actions --json} | jq -r '.[] | select(.ui or .terminal_only) | .name' | sort)"
missing="$(comm -23 <(printf '%s\n' "$agent") <(printf '%s\n' "$ui"))"
[ -z "$missing" ] || { echo "FAIL: no UI path or terminal-only reason for: $missing"; exit 1; }
echo "ok: $(printf '%s\n' "$agent" | wc -l | tr -d ' ') actions on every path"
