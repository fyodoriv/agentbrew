#!/bin/bash
# agentbrew/hooks/verifiers/pr-body-explains-why.sh
#
# **Hook**: pr-body-explains-why
# **Event**: PreToolUse on Bash (`gh pr create --body ...`)
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: shared-rules.md:576 "PR Bodies Explain WHY"
# **Bypass**: `HOOK_BYPASS_PR_BODY_EXPLAINS_WHY=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="pr-body-explains-why"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_PR_BODY_EXPLAINS_WHY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_PR_BODY_EXPLAINS_WHY=1"
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

if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+create\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create"
fi

if printf '%s' "$COMMAND" | grep -qE '(^|[[:space:]])--body-file([[:space:]=]|$)'; then
  verdict_bypass "$HOOK_ID" "--body-file uses external content"
fi

extract_inline_body() {
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  python3 -c '
import shlex
import sys

try:
    parts = shlex.split(sys.stdin.read())
except ValueError:
    sys.exit(0)

for index, part in enumerate(parts):
    if part == "--body" and index + 1 < len(parts):
        print(parts[index + 1])
        break
    if part.startswith("--body="):
        print(part.split("=", 1)[1])
        break
'
}

BODY="$(printf '%s' "$COMMAND" | extract_inline_body)"
if [ -z "$BODY" ]; then
  verdict_bypass "$HOOK_ID" "no inline --body"
fi

TITLE="$(printf '%s' "$COMMAND" | sed -nE 's/.*--title[[:space:]]+"([^"]*)".*/\1/p' | head -1)"
TITLE="${TITLE:-$(printf '%s' "$COMMAND" | sed -nE "s/.*--title[[:space:]]+'([^']*)'.*/\1/p" | head -1)}"

VERIFIER_PROMPT='You are a strict PR rationale verifier for cold readers. Judge whether the PR body explains WHY the change is needed — motivation, problem, risk, or user impact — not just WHAT files changed. ALLOW when the body gives a reader without repo context enough reason to approve. BLOCK only when the body is a file list, changelog dump, or test plan with no motivation. Default to ALLOW for ambiguity. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
PR title:
${TITLE:-"(none)"}

PR body:
$BODY
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "PR body may not explain WHY this change is needed for a cold reader. Add motivation, problem statement, or user impact before creating the PR. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "PR body explains why or verifier default-allowed: $VERDICT"
