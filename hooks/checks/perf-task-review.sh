#!/bin/bash
# agentbrew/hooks/checks/perf-task-review.sh
#
# **Hook**: perf-task-review
# **Event**: Stop
# **Verdict**: block (once per turn, and only for long turns)
# **Bypass**: HOOK_BYPASS_PERF_TASK_REVIEW=1 (MINSKY_PIPELINE=1 also skips it)
#
# When this turn spent at least AGENTBREW_PERF_REVIEW_MIN_SECS (default 300)
# seconds in tools, block the stop once and ask the agent for a short
# "Time review": what took longest, one concrete speedup, and a task when a
# speedup saves a minute or more and recurs. `stop_hook_active` is true on
# the stop that follows a block, so the hook never loops.

set -uo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/verdict.sh"
set +e

readonly HOOK_ID="perf-task-review"
HELPER="${AGENTBREW_PERF_HELPER:-$HOME/.config/agentbrew/scripts/agent-perf.mjs}"
MIN_SECS="${AGENTBREW_PERF_REVIEW_MIN_SECS:-300}"
case "$MIN_SECS" in '' | *[!0-9]*) MIN_SECS=300 ;; esac

[ "${HOOK_BYPASS_PERF_TASK_REVIEW:-0}" = "1" ] && verdict_bypass "$HOOK_ID" "HOOK_BYPASS_PERF_TASK_REVIEW=1"
[ "${MINSKY_PIPELINE:-0}" = "1" ] && verdict_bypass "$HOOK_ID" "MINSKY_PIPELINE=1"

INPUT="$(read_hook_stdin)"
[ "$(json_get "${INPUT:-{\}}" '.stop_hook_active')" = "true" ] && verdict_bypass "$HOOK_ID" "stop_hook_active"
SID="$(json_get "${INPUT:-{\}}" '.session_id')"
[ -n "$SID" ] || verdict_bypass "$HOOK_ID" "no session_id"
[ -f "$HELPER" ] || verdict_bypass "$HOOK_ID" "agent-perf.mjs not deployed"
command -v node >/dev/null 2>&1 || verdict_bypass "$HOOK_ID" "node not on PATH"

TURN="$(node "$HELPER" turn --session "$SID" --json 2>/dev/null)"
[ -n "$TURN" ] || verdict_bypass "$HOOK_ID" "no turn data"

# shellcheck disable=SC2016
REASON="$(hook_jq -r --argjson min "$MIN_SECS" --arg sid "$SID" '
  def dur: (. / 1000 | floor) as $s
    | if $s < 60 then "\($s)s" elif $s < 3600 then "\($s / 60 | floor)m\($s % 60)s"
      else "\($s / 3600 | floor)h\(($s % 3600) / 60 | floor)m" end;
  if (.toolMs // 0) < ($min * 1000) then empty
  else
    "Time review needed: this turn spent \(.toolMs | dur) in tools (threshold \($min * 1000 | dur)). "
    + "Slowest steps: \([.slowest[] | "\(.key) \(.ms | dur)"] | join(", ")). "
    + "Before you stop, add a short \"Time review\" (at most 5 lines): what took longest, one concrete speedup, "
    + "and whether the slow step recurs. When a speedup saves 1 minute or more and recurs, file a task for it. "
    + "Details: node ~/.config/agentbrew/scripts/agent-perf.mjs report --session \($sid). Guide: the perf-review skill."
  end
' <<<"$TURN" 2>/dev/null)"
[ -n "$REASON" ] || verdict_allow "$HOOK_ID" "turn below review threshold"

hook_jq -nc --arg reason "$REASON" '{decision: "block", reason: $reason}' || exit 0
log_decision "$HOOK_ID" "block" "asked for a time review"
exit 0
