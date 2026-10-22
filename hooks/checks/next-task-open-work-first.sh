#!/bin/bash
# agentbrew/hooks/checks/next-task-open-work-first.sh
#
# **Hook**: next-task-open-work-first
# **Event**: UserPromptSubmit
# **Verdict**: warn (adds context; never blocks)
# **Source rule**: templates/AGENTS.md "Open work first"; skill-plugins/workflow/wrap-up/SKILL.md
#
# `next-task` ships from tasksmd/tasks.md, so agentbrew cannot add a step to
# it. This hook does it from outside: when a prompt starts `/next-task` (or
# "next task"), it runs the wrap-up skill's open-work.sh on the working
# directory and adds its list (your open PRs, unmerged branches, uncommitted
# files) to the context, with the order to continue that work first.
#
# **What adds context**:
#   - `/next-task`, `/next-task P1`, `next-task`, `next task please` while
#     the repo has open work
#
# **What stays silent**:
#   - any other prompt
#   - a repo with no open work (open-work.sh exits 0)
#   - machines without the wrap-up skill installed (opt-in by installing it)
#
# **Bypass**: `HOOK_BYPASS_NEXT_TASK_OPEN_WORK_FIRST=1`
#
# **Configuration** (optional):
#   - WRAP_UP_SKILL_DIR: installed skill folder. Default:
#     `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/wrap-up`.
#   - OPEN_WORK_NO_FETCH / OPEN_WORK_NO_GH: passed through to open-work.sh.
#     The hook skips `git fetch` by default (OPEN_WORK_NO_FETCH=1) to stay fast.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="next-task-open-work-first"

if [ "${HOOK_BYPASS_NEXT_TASK_OPEN_WORK_FIRST:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NEXT_TASK_OPEN_WORK_FIRST=1"
fi

INPUT="$(read_hook_stdin)"
PROMPT="$(json_get "$INPUT" '.prompt')"
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
case "$(printf '%s' "$PROMPT" | head -1 | tr '[:upper:]' '[:lower:]')" in
  "/next-task" | "/next-task "* | "next-task" | "next-task "* | "next task" | "next task "*) ;;
  *) verdict_allow "$HOOK_ID" "not a next-task prompt" ;;
esac

SKILL_DIR="${WRAP_UP_SKILL_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/wrap-up}"
if [ ! -f "$SKILL_DIR/scripts/open-work.sh" ]; then
  verdict_allow "$HOOK_ID" "wrap-up skill not installed"
fi

CWD="$(json_get "$INPUT" '.cwd')"
[ -n "$CWD" ] && [ -d "$CWD" ] || CWD="$PWD"

set +e
LIST="$(OPEN_WORK_NO_FETCH="${OPEN_WORK_NO_FETCH:-1}" bash "$SKILL_DIR/scripts/open-work.sh" "$CWD" 2>/dev/null)"
RC=$?
set -e
if [ "$RC" != 1 ]; then
  verdict_allow "$HOOK_ID" "no open work (or not a git checkout)"
fi

CONTEXT="Before you pick a task: this repo has open work (wrap-up skill, open-work.sh):
$LIST
Continue it first. For an open draft PR, read its ## Pending list and its task, then do the first item that is not blocked; fix conflicts, red checks, and review comments; merge when green per the repo's delivery rules (wrap-up SKILL.md, \"Continue open work\"). Claim a new task only when every open item is blocked on a person, and say which."

log_decision "$HOOK_ID" "warn" "next-task: added open-work context"
hook_jq -cn --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
exit 0
