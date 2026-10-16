#!/bin/bash
# agentbrew/hooks/checks/goal-contract-before-edit.sh
#
# **Hook**: goal-contract-before-edit
# **Event**: PreToolUse on Write|Edit|MultiEdit|NotebookEdit
# **Verdict**: block (and auto-approves the one contract-file Write)
# **Source rule**: skill-plugins/workflow/run-goal/SKILL.md "Order of work"
#
# After `/goal <condition>`, run-goal says: write the goal contract before
# the first edit. Live runs showed skill text alone is not enough (a
# one-line bugfix went straight to Edit). A transcript-based check was not
# reliable either: Claude Code writes the transcript in batches, so a
# contract printed several seconds earlier was often not on disk yet, and
# real contracts were blocked.
#
# So the contract is a file. goal-set-loads-run-goal tells the agent the
# path `<state dir>/<session_id>.contract.md`. This hook:
#   - approves a Write to that exact path (no permission prompt) when its
#     content has "Done when", "Metric", and "Pivot", and blocks it otherwise;
#   - blocks other file edits while the session's goal is pending and no
#     valid contract file exists;
#   - allows everything in sessions with no pending goal.
#
# **State** (session-file scope, shared with goal-set-loads-run-goal):
# `<session_id>.pending` exists from `/goal <condition>` until a valid
# contract file is written or `/goal clear` runs. `<session_id>.contract.md`
# holds the contract; goal-set-loads-run-goal deletes contract files older
# than seven days. A pending marker older than one day is stale: this hook
# deletes it and allows the edit. Nothing else reads or writes these files.
#
# **Bypass**: `HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-contract-before-edit"

if [ "${HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT=1"
fi

INPUT="$(read_hook_stdin)"
TOOL="$(json_get "$INPUT" '.tool_name')"
case "$TOOL" in
  Write | Edit | MultiEdit | NotebookEdit) ;;
  *) verdict_allow "$HOOK_ID" "not a file edit" ;;
esac

SESSION_ID="$(json_get "$INPUT" '.session_id')"
case "$SESSION_ID" in
  "" | *[!A-Za-z0-9_-]*) verdict_allow "$HOOK_ID" "no usable session id" ;;
esac

STATE_DIR="${RUN_GOAL_STATE_DIR:-$HOME/.cache/agentbrew/run-goal}"
MARKER="$STATE_DIR/$SESSION_ID.pending"
CONTRACT="$STATE_DIR/$SESSION_ID.contract.md"
FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"

has_sections() {
  hook_jq -e -R -s 'test("Done when") and test("Metric") and test("Pivot")' >/dev/null 2>&1
}

if [ "$TOOL" = "Write" ] && [ "$FILE_PATH" = "$CONTRACT" ]; then
  if json_get "$INPUT" '.tool_input.content' | has_sections; then
    rm -f "$MARKER"
    log_decision "$HOOK_ID" "allow" "goal contract file written"
    hook_jq -cn '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "run-goal contract file"}}'
    exit 0
  fi
  verdict_block "$HOOK_ID" "The goal contract file needs the Done when, Metric (baseline, target, command), and Success / Pivot sections. Rewrite it with all three."
fi

if [ ! -f "$MARKER" ]; then
  verdict_allow "$HOOK_ID" "no pending goal contract"
fi

if [ -n "$(find "$MARKER" -mmin +1440 2>/dev/null)" ]; then
  rm -f "$MARKER"
  verdict_allow "$HOOK_ID" "stale goal marker removed"
fi

if [ -f "$CONTRACT" ] && has_sections <"$CONTRACT"; then
  rm -f "$MARKER"
  verdict_allow "$HOOK_ID" "goal contract file found"
fi

verdict_block "$HOOK_ID" "A /goal is active and its goal contract is not saved yet. Print the contract in the chat, then save the same text with the Write tool to $CONTRACT (Done when with proof, Metric with baseline, Success / Pivot, Suggestions). That write is pre-approved. Then retry this edit."
