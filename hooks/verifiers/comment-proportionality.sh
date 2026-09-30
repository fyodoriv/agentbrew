#!/bin/bash

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="comment-proportionality-verifier"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_COMMENT_PROPORTIONALITY_VERIFIER:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_COMMENT_PROPORTIONALITY_VERIFIER=1"
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
  *.test.*|*.spec.*|*/__tests__/*|*/tests/*|*.md|*.markdown|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock)
    verdict_bypass "$HOOK_ID" "$FILE_PATH out of scope"
    ;;
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rs|*.java|*.rb|*.cpp|*.c|*.h|*.sh)
    ;;
  *)
    verdict_bypass "$HOOK_ID" "$FILE_PATH not a code file"
    ;;
esac

CHANGED_TEXT="$(json_get "$INPUT" '.tool_input.content // .tool_input.new_string // empty')"
CHANGED_TEXT="${CHANGED_TEXT:0:12000}"
if [ -z "$CHANGED_TEXT" ]; then
  verdict_bypass "$HOOK_ID" "no changed text"
fi

MAX_COMMENT_BLOCK="$(
  printf '%s\n' "$CHANGED_TEXT" | awk '
    /^[[:space:]]*(\/\/|#|\/\*|\*\/?|\*)/ { run++; if (run > max) max = run; next }
    /^[[:space:]]*$/ { next }
    { run = 0 }
    END { print max + 0 }
  '
)"

if [ -z "$MAX_COMMENT_BLOCK" ] || [ "$MAX_COMMENT_BLOCK" -lt 4 ]; then
  verdict_bypass "$HOOK_ID" "no long comment block"
fi

VERIFIER_PROMPT='You are a strict comment-proportionality verifier. Inspect the changed code. ALLOW comments that explain non-obvious algorithms, public API contracts, security constraints, or cross-file behavior. BLOCK only when comments are disproportionate to the adjacent code, such as a long explanatory block above trivial one-line code, comments restating obvious syntax, or prose that should be moved to docs. Default to ALLOW for ambiguity. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
File path:
$FILE_PATH

Longest consecutive comment block: $MAX_COMMENT_BLOCK

Changed text:
$CHANGED_TEXT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "Comments may be disproportionate to the adjacent code. Prefer clearer names/code, shorten the block, or move durable explanation to docs. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "comment-proportionality verifier allowed: $VERDICT"
