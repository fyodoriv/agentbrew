#!/bin/bash
# agentbrew/hooks/checks/poll-loop-hint.sh
#
# **Hook**: poll-loop-hint
# **Event**: PreToolUse on Bash
# **Verdict**: warn (a hint as additionalContext; never blocks)
#
# A foreground `until`/`while` loop that polls with `sleep` holds the agent
# until the loop ends or the tool call times out. The 2026-10-18 agent time
# review found such loops to be the most expensive recurring step. This hook
# adds a hint that names the cheaper waits: run the long command in the
# background and wait for its completion notice, use a blocking wait, or
# raise the poll interval.
#
# **Hints on**: a loop keyword in command position (`until`/`while`) with a
# `sleep` command after it, for example
#   until test -f build.done; do sleep 10; done
#
# **Silent on**: loops without `sleep`, the words inside quoted strings,
# comments, or heredoc bodies (stripped by lib/shell-code-only.pl), and
# calls with `run_in_background: true` (the agent already gets a notice).
#
# **Bypass**: `HOOK_BYPASS_POLL_LOOP_HINT=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="poll-loop-hint"

if [ "${HOOK_BYPASS_POLL_LOOP_HINT:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_POLL_LOOP_HINT=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

if [ "$(json_get "$INPUT" '.tool_input.run_in_background')" = "true" ]; then
  verdict_bypass "$HOOK_ID" "already run in the background"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
case "$COMMAND" in
  *until* | *while*) ;;
  *) verdict_bypass "$HOOK_ID" "no loop keyword" ;;
esac
case "$COMMAND" in
  *sleep*) ;;
  *) verdict_bypass "$HOOK_ID" "no sleep" ;;
esac

CODE="$(printf '%s' "$COMMAND" | perl "$__HOOK_LIB_DIR/shell-code-only.pl")"

# Command position: line start, after ; & | ( {, or after do/then/else.
CMD_POS='(^|[;&|({]|[[:space:]](do|then|else))[[:space:]]*'
LOOP_THEN_SLEEP="$(printf '%s' "$CODE" | tr '\n' ';' |
  grep -E "${CMD_POS}(until|while)[[:space:]].*${CMD_POS}sleep([[:space:]]|;|$)" || true)"
if [ -z "$LOOP_THEN_SLEEP" ]; then
  verdict_allow "$HOOK_ID" "no sleep-based poll loop"
fi

HINT="This command polls with a sleep loop, which holds you until it ends or times out. Cheaper waits: (1) run the long command with run_in_background: true and wait for its completion notice; (2) use a blocking wait such as gh pr checks --watch, gh run watch, or wait <pid>; (3) if you must poll, raise the poll interval and cap the total time. Bypass: HOOK_BYPASS_POLL_LOOP_HINT=1."

log_decision "$HOOK_ID" "warn" "sleep-based poll loop"
hook_jq -nc --arg ctx "$HINT" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}' || true
exit 0
