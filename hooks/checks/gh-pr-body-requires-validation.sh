#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-requires-validation.sh
#
# **Hook**: gh-pr-body-requires-validation
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: task-command-center skill "PR validation block (IRON LAW)"
#                  + templates/AGENTS.md PR validation sections
#
# Blocks `gh pr create` / `gh pr edit` when the PR body lacks ANY of:
#   - ## Requirements checklist (alias: ## What this change is about)
#   - ## Previous state (alias: ## How to see previous state)
#   - ## Validation steps (alias: ## How to validate …)
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-body-requires-validation"

if [ "${HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command"
fi

if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|edit)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

REPO_DIR="$(json_get "$INPUT" '.cwd')"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(pwd -P)"
fi

pr_body_text() {
  local file
  file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)\"([^\"]*)\".*/\2/p" | head -1)"
  if [ -z "$file" ]; then
    file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)'([^']*)'.*/\2/p" | head -1)"
  fi
  if [ -z "$file" ]; then
    file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)([^[:space:]]+).*/\2/p" | head -1)"
  fi
  if [ -n "$file" ] && [ "$file" != "-" ]; then
    if [ "${file#/}" = "$file" ]; then
      file="$REPO_DIR/$file"
    fi
    if [ -f "$file" ]; then
      cat "$file"
      return 0
    fi
  fi

  BODY=""
  BODY=$(printf '%s' "$COMMAND" | sed -nE "s/.*--body[[:space:]]+\"([^\"]*)\".*/\1/p" | head -1)
  if [ -z "$BODY" ]; then
    BODY=$(printf '%s' "$COMMAND" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)
  fi
  if [ -n "$BODY" ]; then
    printf '%s' "$BODY"
    return 0
  fi

  return 1
}

BODY="$(pr_body_text || true)"
if [ -z "$BODY" ]; then
  verdict_bypass "$HOOK_ID" "no --body or readable --body-file"
fi

# Inline --body from hook JSON often carries literal \n instead of newlines.
BODY="$(printf '%b' "$BODY")"

HAS_REQUIREMENTS=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+(Requirements checklist|What this change is about)' || true)
HAS_PREVIOUS=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+(Previous state|How to see previous state)' || true)
HAS_VALIDATION=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+(Validation steps|How to validate)' || true)

HAS_SUMMARY=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+Summary' || true)
HAS_DELIVERY=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+Delivery plan' || true)
HAS_TEST_PLAN=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+Test plan' || true)

# Stacked skill / cross-repo carve-out: Summary + Delivery plan + Test plan
if [ "$HAS_SUMMARY" -ge 1 ] && [ "$HAS_DELIVERY" -ge 1 ] && [ "$HAS_TEST_PLAN" -ge 1 ]; then
  verdict_allow "$HOOK_ID" "stacked skill PR sections present (Summary + Delivery plan + Test plan)"
fi

MISSING=""
if [ "$HAS_REQUIREMENTS" = "0" ]; then
  MISSING="${MISSING}  - ## Requirements checklist (honest task requirement checkboxes)\n"
fi
if [ "$HAS_PREVIOUS" = "0" ]; then
  MISSING="${MISSING}  - ## Previous state (repro steps or path to feature surface)\n"
fi
if [ "$HAS_VALIDATION" = "0" ]; then
  MISSING="${MISSING}  - ## Validation steps (manual reviewer verification)\n"
fi

if [ -n "$MISSING" ]; then
  verdict_block "$HOOK_ID" "PR body missing required validation sections (task-command-center IRON LAW). Add either the full block OR stacked-skill trio (Summary + Delivery plan + Test plan):
${MISSING}Template: agentbrew/skill-plugins/dev/task-command-center/SKILL.md § PR validation block.
Bypass: HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION=1."
fi

verdict_allow "$HOOK_ID" "PR validation sections present"
