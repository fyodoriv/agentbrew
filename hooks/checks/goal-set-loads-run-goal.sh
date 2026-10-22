#!/bin/bash
# agentbrew/hooks/checks/goal-set-loads-run-goal.sh
#
# **Hook**: goal-set-loads-run-goal
# **Event**: UserPromptSubmit
# **Verdict**: warn (adds context; never blocks)
# **Source rule**: skill-plugins/workflow/run-goal/SKILL.md
#
# Claude Code's built-in `/goal <condition>` fires UserPromptSubmit with the
# raw prompt text. A skill description alone triggers only when the model
# decides to load it. This hook makes the trigger deterministic: when a goal
# is set and the run-goal skill is installed, it adds context that tells the
# agent to load run-goal before any other work.
#
# **What adds context**:
#   - `/goal fix the flaky tests`
#   - `  /goal   ship the release` (leading spaces)
#
# **What stays silent**:
#   - `/goal` (status), `/goal clear|stop|off|reset|none|cancel`
#   - any prompt that does not start with `/goal`
#   - machines without the run-goal skill installed (opt-in by installing it)
#
# **Bypass**: `HOOK_BYPASS_GOAL_SET_LOADS_RUN_GOAL=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_SKILL_DIR: installed skill folder to check. Default:
#     `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/run-goal`.
#   - RUN_GOAL_SOURCE_DIR: the run-goal source folder to name in the context.
#     Default: the first `<dir>/skill-plugins/workflow/run-goal` that exists
#     for `$HOME/apps/*/agentbrew`, `$HOME/apps/agentbrew`, `$HOME/src/agentbrew`.
#     Live retros skipped run-goal when they had to search for its source.
#   - RUN_GOAL_STATE_DIR: marker folder shared with goal-contract-before-edit.
#     Default `$HOME/.cache/agentbrew/run-goal`.
#
# **State** (session-file scope): when it adds context, this hook writes
# `<state dir>/<session_id>.pending` and names `<session_id>.contract.md` in
# the context, so goal-contract-before-edit can hold file edits until the
# contract is saved there. `/goal clear` (and its aliases) deletes both
# files; contract files older than seven days are deleted here. See
# goal-contract-before-edit.sh for the rest of the lifecycle.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-set-loads-run-goal"

if [ "${HOOK_BYPASS_GOAL_SET_LOADS_RUN_GOAL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GOAL_SET_LOADS_RUN_GOAL=1"
fi

INPUT="$(read_hook_stdin)"
PROMPT="$(json_get "$INPUT" '.prompt')"

# Strip leading whitespace, then require the `/goal` command word.
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
case "$PROMPT" in
  "/goal") verdict_allow "$HOOK_ID" "goal status check" ;;
  "/goal "* | "/goal"$'\t'* | "/goal"$'\n'*) ;;
  *) verdict_allow "$HOOK_ID" "not a goal prompt" ;;
esac

STATE_DIR="${RUN_GOAL_STATE_DIR:-$HOME/.cache/agentbrew/run-goal}"
SESSION_ID="$(json_get "$INPUT" '.session_id')"
case "$SESSION_ID" in
  "" | *[!A-Za-z0-9_-]*) SESSION_ID="" ;;
esac

CONDITION="${PROMPT#/goal}"
CONDITION="${CONDITION#"${CONDITION%%[![:space:]]*}"}"
CONDITION="${CONDITION%"${CONDITION##*[![:space:]]}"}"
case "$(printf '%s' "$CONDITION" | tr '[:upper:]' '[:lower:]')" in
  "" | clear | stop | off | reset | none | cancel)
    if [ -n "$SESSION_ID" ] && [ -n "$CONDITION" ]; then
      rm -f "$STATE_DIR/$SESSION_ID.pending" "$STATE_DIR/$SESSION_ID.contract.md" "$STATE_DIR/$SESSION_ID.stopblocks"
    fi
    verdict_allow "$HOOK_ID" "goal cleared or status"
    ;;
esac

SKILL_DIR="${RUN_GOAL_SKILL_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/run-goal}"
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  verdict_allow "$HOOK_ID" "run-goal skill not installed"
fi

SAVE_STEP=""
SOURCE_DIR="${RUN_GOAL_SOURCE_DIR:-}"
if [ -z "$SOURCE_DIR" ]; then
  for base in "$HOME"/apps/*/agentbrew "$HOME/apps/agentbrew" "$HOME/src/agentbrew"; do
    if [ -f "$base/skill-plugins/workflow/run-goal/SKILL.md" ]; then
      SOURCE_DIR="$base/skill-plugins/workflow/run-goal"
      break
    fi
  done
fi
RETRO_STEP=" The retro's skill updates are in scope for every goal, including run-goal itself"
if [ -n "$SOURCE_DIR" ]; then
  RETRO_STEP="$RETRO_STEP (its source: $SOURCE_DIR; change it in a worktree of that repo)"
fi
RETRO_STEP="$RETRO_STEP. When a skill source is read-only for you (by your rules or the sandbox), do not edit it: record the update as a task in a repo you can write, and cite that task id"
if [ -n "$SESSION_ID" ]; then
  RETRO_STEP="$RETRO_STEP. Save the Skills updated list with Write to $STATE_DIR/$SESSION_ID.retro.md (pre-approved): one line per skill used with its commit SHA, PR, or task id; the session cannot end until every skill used has one"
fi
RETRO_STEP="$RETRO_STEP."
if [ -n "$SESSION_ID" ]; then
  SAVE_STEP=" Then save the same contract text with the Write tool to $STATE_DIR/$SESSION_ID.contract.md (pre-approved); file edits stay blocked until that file has Done when, Metric, and Pivot."
fi
CONTEXT="A goal was just set with /goal. Before any other work, load the run-goal skill (Skill tool, name run-goal) and follow it in order. After read-only intake, your first message is the goal contract (done-when criteria with proof, metric with baseline, success and pivot, suggestions); make no edit before it is in the chat.$SAVE_STEP Then ask at most one round of questions, work without interruptions until the goal is met or hopelessly blocked, print a Goal check line with evidence for each criterion, and finish with the final report, the retro, and updates to the skills you used.$RETRO_STEP"

if [ -n "$SESSION_ID" ] && mkdir -p "$STATE_DIR" 2>/dev/null; then
  rm -f "$STATE_DIR/$SESSION_ID.contract.md" "$STATE_DIR/$SESSION_ID.retro.md" "$STATE_DIR/$SESSION_ID.stopblocks"
  : >"$STATE_DIR/$SESSION_ID.pending" 2>/dev/null || true
  find "$STATE_DIR" \( -name '*.contract.md' -o -name '*.retro.md' -o -name '*.stopblocks' \) -mtime +7 -delete 2>/dev/null || true
fi

log_decision "$HOOK_ID" "warn" "goal set: added run-goal context"
hook_jq -cn --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
exit 0
