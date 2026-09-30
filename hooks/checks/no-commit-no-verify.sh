#!/bin/bash
# agentbrew/hooks/checks/no-commit-no-verify.sh
#
# **Hook**: no-commit-no-verify
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: agentbrew/TASKS.md policy "do NOT bypass commit hooks
#                  (--no-verify)" + dotfiles/TASKS.md
#
# Blocks `git commit --no-verify` and `git commit -n`. The pre-commit
# hooks (conventional commits, shellcheck, biome, scan-secrets) exist
# specifically to catch the class of mistakes agents make routinely
# — bypassing them defeats the purpose. If the pre-commit hook is
# wrong, fix the hook, don't skip it.
#
# **What gets blocked**:
#   - `git commit --no-verify -m "msg"`
#   - `git commit -n -m "msg"`
#   - `git commit -m "msg" --no-verify`
#
# **Bypass**: NONE. This is one of the few hooks with no bypass — the
# rule is iron. Even orchestrator pipelines (MINSKY_PIPELINE=1) honor
# the pre-commit gate.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-commit-no-verify"

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
  verdict_bypass "$HOOK_ID" "no command to check"
fi

# Match git commit with --no-verify or -n (short form). -n is also a
# flag for `git commit -m -n "actual-flag-name"` — we accept the small
# false-positive risk because the alternative (deep arg parsing) is
# brittle.
NO_VERIFY_REGEX='\bgit[[:space:]]+commit\b.*?(--no-verify|[[:space:]]-n[[:space:]]|[[:space:]]-n$)'

if printf '%s' "$COMMAND" | grep -qE "$NO_VERIFY_REGEX"; then
  verdict_block "$HOOK_ID" "git commit --no-verify is forbidden by policy (pre-commit hooks catch class-of-mistake regressions; bypassing them defeats the purpose). If the pre-commit hook is wrong, FIX the hook, don't skip it. No bypass available."
fi

verdict_allow "$HOOK_ID" "no --no-verify pattern detected"
