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

CONDITION="${PROMPT#/goal}"
CONDITION="${CONDITION#"${CONDITION%%[![:space:]]*}"}"
CONDITION="${CONDITION%"${CONDITION##*[![:space:]]}"}"
case "$(printf '%s' "$CONDITION" | tr '[:upper:]' '[:lower:]')" in
  "" | clear | stop | off | reset | none | cancel)
    verdict_allow "$HOOK_ID" "goal cleared or status"
    ;;
esac

SKILL_DIR="${RUN_GOAL_SKILL_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/run-goal}"
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  verdict_allow "$HOOK_ID" "run-goal skill not installed"
fi

CONTEXT="A goal was just set with /goal. Before any other work, load the run-goal skill (Skill tool, name run-goal) and follow it: write the goal contract with checkable done-criteria and a baseline, ask at most one round of questions, then work without interruptions until the goal is met or hopelessly blocked, print evidence for each criterion, and finish with the final report, the retro, and updates to the skills you used."

log_decision "$HOOK_ID" "warn" "goal set: added run-goal context"
hook_jq -cn --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
exit 0
