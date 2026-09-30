#!/bin/bash
# agentbrew/hooks/verifiers/pr-body-diff-consistency.sh
#
# **Hook**: pr-body-diff-consistency
# **Event**: PreToolUse on Bash (`gh pr edit --body ...`)
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: shared-rules.md:600 "PR Bodies Decay — Verify Before Edit"
# **Bypass**: `HOOK_BYPASS_PR_BODY_DIFF_CONSISTENCY=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="pr-body-diff-consistency"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_PR_BODY_DIFF_CONSISTENCY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_PR_BODY_DIFF_CONSISTENCY=1"
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

if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+edit\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr edit"
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

collect_diff_summary() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s\n' "(not inside a git worktree)"
    return 0
  fi
  {
    printf '%s\n' "## git diff --stat HEAD"
    git diff --stat HEAD -- 2>/dev/null || git diff --stat -- 2>/dev/null || true
    printf '%s\n' "## git diff --name-only HEAD"
    git diff --name-only HEAD -- 2>/dev/null || git diff --name-only -- 2>/dev/null || true
  } | head -c 12000
}

DIFF_SUMMARY="$(collect_diff_summary)"
if [ -z "$DIFF_SUMMARY" ]; then
  DIFF_SUMMARY="(no local diff detected)"
fi

VERIFIER_PROMPT='You are a strict PR-body freshness verifier. Compare the edited PR body to the current git diff summary. ALLOW when the body is broadly consistent with the changed files or gives a reasonable high-level release/update note. BLOCK only when the body is materially stale, names unrelated work, or claims changes that the diff summary clearly does not support. Default to ALLOW for ambiguity. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
PR body:
$BODY

Current diff summary:
$DIFF_SUMMARY
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "PR body appears stale relative to the current diff. Re-read \`git diff --stat HEAD\` / \`git diff --name-only HEAD\`, update the PR body to match the actual changes, then retry. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "PR body matches current diff or verifier default-allowed: $VERDICT"
