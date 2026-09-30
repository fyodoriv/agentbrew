#!/bin/bash
# agentbrew/hooks/checks/no-force-push-protected.sh
#
# **Hook**: no-force-push-protected
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Git Safety (Multi-Agent)" + every repo's
#                  branch-protection policy
#
# Blocks `git push --force` / `git push -f` / `git push --force-with-lease`
# when the push target is `main`, `master`, or `develop`. Force-pushing a
# protected branch wipes other contributors' commits in flight. The
# canonical workaround is to open a fresh PR and let the merge strategy
# (squash / rebase / merge-commit) handle the integration.
#
# **What gets blocked**:
#   - `git push -f origin main`
#   - `git push --force origin master`
#   - `git push --force-with-lease origin develop`
#   - `git push origin main --force` (flag order doesn't matter)
#
# **What does NOT get blocked**:
#   - `git push --force origin <feature-branch>` (feature branches are
#     fair game for force-push — that's the whole point)
#   - `git push` with no --force flag (regular push to main is allowed
#     by this hook; branch protection on the remote is the real gate)
#
# **Bypass**: `HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED=1` for the absolute
# emergency where a force-push to protected IS the right move
# (post-incident history rewrite, etc. — extremely rare).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-force-push-protected"

if [ "${HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED=1"
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
  verdict_bypass "$HOOK_ID" "no command to check"
fi

# Match git push with --force / -f / --force-with-lease anywhere in command
FORCE_REGEX='\bgit[[:space:]]+push\b.*?(--force|-f\b|--force-with-lease)'

if ! printf '%s' "$COMMAND" | grep -qE "$FORCE_REGEX"; then
  verdict_allow "$HOOK_ID" "no force-push flag detected"
fi

# Now check if the target branch is protected. Match patterns like:
#   git push origin main
#   git push -f origin master
#   git push --force-with-lease origin develop
PROTECTED_REGEX='\b(main|master|develop)\b'

if printf '%s' "$COMMAND" | grep -qE "$PROTECTED_REGEX"; then
  verdict_block "$HOOK_ID" "git push --force to main/master/develop is forbidden — overwrites other contributors' commits. Use a feature branch + PR instead. Bypass: HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED=1 (only for post-incident history rewrites)."
fi

verdict_allow "$HOOK_ID" "force-push to non-protected branch (allowed)"
