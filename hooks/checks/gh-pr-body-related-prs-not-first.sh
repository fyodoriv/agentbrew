#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-related-prs-not-first.sh
#
# **Hook**: gh-pr-body-related-prs-not-first
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Never lead with cross-PR navigation sections"
#
# Blocks `gh pr create` / `gh pr edit` when Related PRs (or similar cross-PR
# navigation sections) lead the description or appear before the main summary.
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_RELATED_PRS_NOT_FIRST=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"
# shellcheck source=../lib/gh-pr-body-from-command.sh
source "$__HOOK_LIB_DIR/gh-pr-body-from-command.sh"

readonly HOOK_ID="gh-pr-body-related-prs-not-first"

if [ "${HOOK_BYPASS_GH_PR_BODY_RELATED_PRS_NOT_FIRST:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_RELATED_PRS_NOT_FIRST=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command"
fi

if ! gh_in_command_position "$COMMAND" 'pr[[:space:]]+(create|edit)'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

REPO_DIR="$(json_get "$INPUT" '.cwd')"
if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR" ]; then
  REPO_DIR="$(pwd -P)"
fi

BODY=""
if ! BODY="$(gh_pr_body_or_file "$COMMAND" "$REPO_DIR")"; then
  if grep -qE -e '--body-file' <<<"$COMMAND"; then
    verdict_bypass "$HOOK_ID" "--body-file not readable"
  fi
  verdict_bypass "$HOOK_ID" "no --body arg detected"
fi

FIRST_H2="$(printf '%s' "$BODY" | grep -iE '^##[[:space:]]+' | head -1 || true)"
if [ -n "$FIRST_H2" ] && grep -qiE '^##[[:space:]]+(related[[:space:]]+pr|merge[[:space:]]+order|reuse[[:space:]]+chain|dependency[[:space:]]+(pr|chain))' <<<"$FIRST_H2"; then
  verdict_block "$HOOK_ID" "PR body leads with a cross-PR navigation section ($FIRST_H2). Lead with what this PR does and how to verify it; move Related PRs / merge-order maps near the bottom (after tests, verification, rollback). Bypass: HOOK_BYPASS_GH_PR_BODY_RELATED_PRS_NOT_FIRST=1."
fi

CONTENT_LINE="$(printf '%s' "$BODY" | grep -niE '^##[[:space:]]+(summary|what this pr adds|what the skill does|why|motivation|what changed)' | head -1 | cut -d: -f1 || true)"
RELATED_LINE="$(printf '%s' "$BODY" | grep -niE '^##[[:space:]]+(related[[:space:]]+pr|merge[[:space:]]+order|reuse[[:space:]]+chain|dependency[[:space:]]+(pr|chain))' | head -1 | cut -d: -f1 || true)"

if [ -n "$RELATED_LINE" ]; then
  if [ -z "$CONTENT_LINE" ] || [ "$RELATED_LINE" -lt "$CONTENT_LINE" ]; then
    verdict_block "$HOOK_ID" "PR body places cross-PR navigation before the main summary. Put Related PRs / merge-order sections near the bottom, after scope/tests/verification. Bypass: HOOK_BYPASS_GH_PR_BODY_RELATED_PRS_NOT_FIRST=1."
  fi
fi

verdict_allow "$HOOK_ID" "Related PRs section order OK"
