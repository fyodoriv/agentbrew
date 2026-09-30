#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-no-review-response.sh
#
# **Hook**: gh-pr-body-no-review-response
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "PR bodies stay artifact-focused"
#
# Blocks `gh pr create` / `gh pr edit` when the PR body contains review-response
# sections that belong in PR comments, not durable PR descriptions.
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_NO_REVIEW_RESPONSE=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-body-no-review-response"

if [ "${HOOK_BYPASS_GH_PR_BODY_NO_REVIEW_RESPONSE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_NO_REVIEW_RESPONSE=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
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

# Real newlines inside quoted --body break sed; flatten for extraction only.
COMMAND_ONELINE="$(printf '%s' "$COMMAND" | tr '\n' ' ')"

BODY=""
BODY=$(printf '%s' "$COMMAND_ONELINE" | sed -nE 's/.*--body[[:space:]]+"([^"]*)".*/\1/p' | head -1)
if [ -z "$BODY" ]; then
  BODY=$(printf '%s' "$COMMAND_ONELINE" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)
fi
if [ -z "$BODY" ]; then
  if printf '%s' "$COMMAND_ONELINE" | grep -qE '--body-file'; then
    verdict_bypass "$HOOK_ID" "--body-file used (not scanned inline)"
  fi
  verdict_bypass "$HOOK_ID" "no --body arg detected"
fi

# Unescape common \n sequences from JSON-embedded shell commands for line-anchored checks.
BODY="$(printf '%s' "$BODY" | sed 's/\\n/\n/g')"

MATCHED_PATTERN=""
if printf '%s' "$BODY" | grep -qiE '^#{2,3}[[:space:]]+.*(review(er)?[[:space:]]+feedback[[:space:]]+addressed|feedback[[:space:]]+addressed|addressed[[:space:]]+review[[:space:]]+comments?)'; then
  MATCHED_PATTERN="review-response heading"
elif printf '%s' "$BODY" | grep -qiE '^#{2,3}[[:space:]]+.*(qodo|coderabbit|bugbot).*(review|comments?)'; then
  MATCHED_PATTERN="bot-review heading"
elif printf '%s' "$BODY" | grep -qiE '^#{2,3}[[:space:]]+.*review[[:space:]]*[—-][[:space:]]*resolved'; then
  MATCHED_PATTERN="review - resolved heading"
elif printf '%s' "$BODY" | grep -qiE '^#{2,3}[[:space:]]+.*review[[:space:]]+comments?[[:space:]]+(resolved|addressed)'; then
  MATCHED_PATTERN="review comments resolved heading"
fi

if [ -n "$MATCHED_PATTERN" ]; then
  verdict_block "$HOOK_ID" "PR body contains a review-response section ($MATCHED_PATTERN). Keep PR descriptions artifact-focused (what/why/verification). Reply to reviewers with \`gh pr comment\`, not PR-body headings like 'Qodo review — resolved'. Bypass: HOOK_BYPASS_GH_PR_BODY_NO_REVIEW_RESPONSE=1."
fi

verdict_allow "$HOOK_ID" "no review-response section detected"
