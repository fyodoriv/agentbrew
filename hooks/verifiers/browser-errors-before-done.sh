#!/bin/bash

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="browser-errors-before-done"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_BROWSER_ERRORS_BEFORE_DONE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_BROWSER_ERRORS_BEFORE_DONE=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
if [ "$HOOK_EVENT_NAME" != "Stop" ]; then
  verdict_bypass "$HOOK_ID" "not a Stop event"
fi

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  verdict_bypass "$HOOK_ID" "no transcript path"
fi

SUMMARY="$(
  jq -r '
    .message.content[]? | select(.type == "tool_use") |
    if (.name == "Write" or .name == "Edit") then "EDIT\t\(.name)\t\(.input.file_path // "")"
    elif .name == "Bash" then "BASH\t\(.input.command // "")"
    else "TOOL\t\(.name // "")"
    end
  ' "$TRANSCRIPT_PATH" 2>/dev/null || true
)"
SUMMARY="${SUMMARY:0:16000}"

FRONTEND_EDITS="$(
  printf '%s\n' "$SUMMARY" | awk -F '\t' '$1 == "EDIT" && $3 ~ /\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/ { count++ } END { print count + 0 }'
)"

if [ -z "$FRONTEND_EDITS" ] || [ "$FRONTEND_EDITS" = "0" ]; then
  verdict_bypass "$HOOK_ID" "no frontend edits"
fi

VERIFIER_PROMPT='You are a strict frontend completion verifier. The transcript summary lists edited files and tool calls from the current turn. ALLOW when browser console/network errors were checked after frontend/page edits, for example with page-zero-errors, check-page-errors.sh, agent-browser, Playwright, or Chrome DevTools console/network tooling. BLOCK only when the assistant appears ready to stop after editing frontend UI files without checking browser console errors and failing network requests. Default to ALLOW for ambiguity. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
Frontend edit count: $FRONTEND_EDITS

Transcript tool summary:
$SUMMARY
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "Frontend/page work touched $FRONTEND_EDITS file(s) but browser console/network errors may not have been checked. Run page-zero-errors or an equivalent browser console + failing-network inventory before calling the UI work done. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "frontend browser-error verifier allowed: $VERDICT"
