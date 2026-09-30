#!/bin/bash

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="fix-errors-never-silence"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_FIX_ERRORS_NEVER_SILENCE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_FIX_ERRORS_NEVER_SILENCE=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
if [ "$HOOK_EVENT_NAME" != "PostToolUse" ]; then
  verdict_bypass "$HOOK_ID" "not a PostToolUse event"
fi
if [ "$HOOK_TOOL_NAME" != "Write" ] && [ "$HOOK_TOOL_NAME" != "Edit" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Write/Edit"
fi

FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"
case "$FILE_PATH" in
  *.md|*.markdown|*.txt)
    verdict_bypass "$HOOK_ID" "$FILE_PATH out of scope"
    ;;
esac

CHANGED_TEXT="$(json_get "$INPUT" '.tool_input.content // .tool_input.new_string // empty')"
CHANGED_TEXT="${CHANGED_TEXT:0:12000}"
if [ -z "$CHANGED_TEXT" ]; then
  verdict_bypass "$HOOK_ID" "no changed text"
fi

if ! printf '%s' "$CHANGED_TEXT" | grep -qiE 'silenc|suppress|disable|disabled|noop|no-op|skip|ignore|eslint-disable|ts-ignore|catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*\}'; then
  verdict_bypass "$HOOK_ID" "no suppression-shaped change"
fi

TOOL_RESULT="$(json_get "$INPUT" '.tool_result // empty')"
TOOL_RESULT="${TOOL_RESULT:0:4000}"

VERIFIER_PROMPT='You are a strict error-fix verifier. Inspect the changed text and optional tool result. ALLOW legitimate fixes, user-facing options, tests that intentionally cover disabled states, or ambiguous changes. BLOCK only when the change appears to hide, silence, suppress, disable, skip, ignore, noop, or swallow an error/failing check instead of fixing the root cause. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
File path:
$FILE_PATH

Changed text:
$CHANGED_TEXT

Tool result:
$TOOL_RESULT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "This edit may silence or suppress an error instead of fixing the root cause. Fix the underlying failure or document the intentional exception with a task. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "error-silencing verifier allowed: $VERDICT"
