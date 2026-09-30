#!/bin/bash
# shellcheck shell=bash
# Read ~/.config/agentbrew/metrics/latest.json and print a headroom warning when
# static.softTokenHeadroom drops below the alert threshold (default 1800).
#
# Usage: context-budget-headroom.sh
# Exit 0 always; prints warning to stdout when alert applies (hook wraps in verdict_warn).

set -euo pipefail

LATEST="${HOME}/.config/agentbrew/metrics/latest.json"
export CONTEXT_BUDGET_HEADROOM_ALERT="${CONTEXT_BUDGET_HEADROOM_ALERT:-1800}"
export CONTEXT_BUDGET_LATEST_PATH="$LATEST"

if [ ! -f "$LATEST" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

node <<'NODE'
const fs = require("fs");
const threshold = Number(process.env.CONTEXT_BUDGET_HEADROOM_ALERT || "1800");
const latestPath = process.env.CONTEXT_BUDGET_LATEST_PATH;
if (!latestPath) process.exit(0);
try {
  const snap = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const headroom = snap?.static?.softTokenHeadroom;
  const projected = snap?.static?.projectedDeployedTokens;
  const top = snap?.static?.topSections?.[0];
  if (typeof headroom !== "number" || headroom >= threshold) process.exit(0);
  const topHint = top ? ` Top section "${top.heading}" ~${top.tokens} tokens.` : "";
  console.log(
    `context headroom low: ~${headroom} tokens to soft target (<${threshold}); projected ~${projected} tokens.${topHint} Start a new chat for the next task; load context-budget + cursor-token-playbook before adding rules/skills.`,
  );
} catch {
  process.exit(0);
}
NODE
