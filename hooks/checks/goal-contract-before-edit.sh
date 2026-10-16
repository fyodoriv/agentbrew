#!/bin/bash
# agentbrew/hooks/checks/goal-contract-before-edit.sh
#
# **Hook**: goal-contract-before-edit
# **Event**: PreToolUse on Write|Edit|MultiEdit|NotebookEdit
# **Verdict**: block
# **Source rule**: skill-plugins/workflow/run-goal/SKILL.md "Order of work"
#
# After `/goal <condition>`, run-goal says: print the goal contract before
# the first edit. Live runs showed skill text alone is not enough (a
# one-line bugfix went straight to Edit). This hook blocks the first file
# edit of a goal session until an assistant message in the transcript has a
# "Done when" section.
#
# **State** (session-file scope): goal-set-loads-run-goal writes
# `<state dir>/<session_id>.pending` when a goal is set and deletes it on
# `/goal clear`. This hook deletes it once the contract is in the
# transcript. A marker older than one day is stale: this hook deletes it and
# allows the edit. Nothing else reads or writes these files.
#
# **What gets blocked**: Write/Edit in a session with a pending marker and no
# "Done when" in any assistant text of the transcript.
#
# **What does NOT get blocked**: sessions with no marker (no goal set, goal
# cleared, or contract already printed); other tools.
#
# **Bypass**: `HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: marker folder. Default `$HOME/.cache/agentbrew/run-goal`.

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
if [ ! -f "$MARKER" ]; then
  verdict_allow "$HOOK_ID" "no pending goal contract"
fi

if [ -n "$(find "$MARKER" -mmin +1440 2>/dev/null)" ]; then
  rm -f "$MARKER"
  verdict_allow "$HOOK_ID" "stale goal marker removed"
fi

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] &&
  hook_jq -e -s 'any(.[]; .type == "assistant" and any(.message.content[]?; .type == "text" and (.text | test("Done when"))))' \
    "$TRANSCRIPT" >/dev/null 2>&1; then
  rm -f "$MARKER"
  verdict_allow "$HOOK_ID" "goal contract found"
fi

verdict_block "$HOOK_ID" "A /goal is active and no goal contract is in the chat yet. Print the run-goal contract first (Done when with proof, Metric with baseline, Success/Pivot, Suggestions), then retry this edit."
