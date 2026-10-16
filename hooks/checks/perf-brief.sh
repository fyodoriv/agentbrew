#!/bin/bash
# agentbrew/hooks/checks/perf-brief.sh
#
# **Hook**: perf-brief
# **Event**: SessionStart
# **Verdict**: warn (never blocks; it only adds context)
# **Bypass**: HOOK_BYPASS_PERF_BRIEF=1
#
# Gives the agent the 7-day agent time brief for the session's project
# (`agent-perf.mjs brief`, at most 5 lines) as SessionStart
# additionalContext. Silent when the perf log has no rows for the project.

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

readonly HOOK_ID="perf-brief"
HELPER="${AGENTBREW_PERF_HELPER:-$HOME/.config/agentbrew/scripts/agent-perf.mjs}"

[ "${HOOK_BYPASS_PERF_BRIEF:-0}" = "1" ] && verdict_bypass "$HOOK_ID" "HOOK_BYPASS_PERF_BRIEF=1"
[ -f "$HELPER" ] || verdict_bypass "$HOOK_ID" "agent-perf.mjs not deployed"
command -v node >/dev/null 2>&1 || verdict_bypass "$HOOK_ID" "node not on PATH"

INPUT="$(read_hook_stdin)"
CWD="$(json_get "${INPUT:-{\}}" '.cwd')"
[ -n "$CWD" ] || CWD="$PWD"

BRIEF="$(node "$HELPER" brief --cwd "$CWD" 2>/dev/null)"
[ -n "$BRIEF" ] || verdict_bypass "$HOOK_ID" "no perf rows for this project"

hook_jq -nc --arg brief "$BRIEF" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $brief}}' || exit 0
verdict_allow "$HOOK_ID" "added agent time brief"
