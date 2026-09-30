#!/bin/bash
# agentbrew/hooks/checks/context-budget-measure.sh
#
# **Hook**: context-budget-measure
# **Event**: SessionStart
# **Verdict**: allow (non-blocking — schedules background capture)
# **Source rule**: context-budget skill + RECURRING.md context-budget-weekly-audit
#
# Refreshes ~/.config/agentbrew/metrics/latest.json at most once every 6h when
# an agent session starts. Uses the static-only fast path (skip ccusage) and
# never blocks session start — measurement runs in the background.
#
# **Bypass**: `HOOK_BYPASS_CONTEXT_BUDGET_MEASURE=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="context-budget-measure"
readonly STALE_DURATION="6h"

if [ "${HOOK_BYPASS_CONTEXT_BUDGET_MEASURE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_CONTEXT_BUDGET_MEASURE=1"
fi

INPUT="$(read_hook_stdin || true)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "${INPUT:-{}}" '.hook_event_name')"

if [ -n "$HOOK_EVENT_NAME" ] && [ "$HOOK_EVENT_NAME" != "SessionStart" ]; then
  verdict_bypass "$HOOK_ID" "event $HOOK_EVENT_NAME is not SessionStart"
fi

resolve_measure_cmd() {
  if command -v agentbrew >/dev/null 2>&1; then
    printf '%s\n' "agentbrew measure context --quick --if-stale ${STALE_DURATION}"
    return 0
  fi
  if [ -n "${AGENTBREW_REPO_ROOT:-}" ] && [ -x "${AGENTBREW_REPO_ROOT}/dist/cli.js" ]; then
    printf '%s\n' "node ${AGENTBREW_REPO_ROOT}/dist/cli.js measure context --quick --if-stale ${STALE_DURATION}"
    return 0
  fi
  return 1
}

MEASURE_CMD="$(resolve_measure_cmd || true)"
if [ -z "$MEASURE_CMD" ]; then
  verdict_bypass "$HOOK_ID" "agentbrew CLI not available"
fi

# Background capture — session start must not wait for lint/static inventory.
nohup bash -c "$MEASURE_CMD" >/dev/null 2>&1 &
disown >/dev/null 2>&1 || true

# Non-blocking headroom alert from latest.json (even when measure is skipped as fresh).
HEADROOM_LIB="$__HOOK_LIB_DIR/context-budget-headroom.sh"
if [ -x "$HEADROOM_LIB" ] || [ -f "$HEADROOM_LIB" ]; then
  HEADROOM_MSG="$(bash "$HEADROOM_LIB" 2>/dev/null || true)"
  if [ -n "$HEADROOM_MSG" ]; then
    verdict_warn "$HOOK_ID" "$HEADROOM_MSG"
  fi
fi

verdict_allow "$HOOK_ID" "scheduled background measure (if stale > ${STALE_DURATION})"
