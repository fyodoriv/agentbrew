#!/bin/bash
# agentbrew/hooks/checks/git-commit-conventional.sh
#
# **Hook**: git-commit-conventional
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: dotfiles/git-hooks/commit-msg (formalized as hook 2026-05-27)
#
# Enforces conventional-commits format on `git commit -m "msg"` calls:
#   type: lowercase subject TICKET-0000
# Valid types: feat, fix, docs, chore, test, style, refactor, perf, ci,
#              revert, hotfix, build, release
# Header must be ≤72 chars (commitlint standard).
#
# **What gets blocked**:
#   - `git commit -m "added the foo"` (no type prefix)
#   - `git commit -m "Feat: added the foo"` (capitalized type)
#   - `git commit -m "feat:added the foo"` (no space after colon)
#   - `git commit -m "$(cat <<EOF\n... 80-char-line\nEOF\n)"` (header too long)
#
# **What does NOT get blocked**:
#   - `git commit --amend --no-edit` (uses HEAD's message)
#   - `git commit --fixup HEAD` (auto-generated fixup messages)
#   - `git commit -m "Merge ..."` / `Revert ...` (built-in git verbs are exempt)
#   - `git commit` with no -m (opens editor — separate enforcement path
#     via dotfiles/git-hooks/commit-msg)
#
# **Bypass**: `HOOK_BYPASS_GIT_COMMIT_CONVENTIONAL=1`. Or use the editor
# flow (omit -m) which routes through dotfiles/git-hooks/commit-msg
# which has its own enforcement.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="git-commit-conventional"
readonly VALID_TYPES='feat|fix|docs|chore|test|style|refactor|perf|ci|revert|hotfix|build|release'

if [ "${HOOK_BYPASS_GIT_COMMIT_CONVENTIONAL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GIT_COMMIT_CONVENTIONAL=1"
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

# Must contain `git commit` AND `-m` (we only check -m calls; editor flow
# is routed through dotfiles/git-hooks/commit-msg).
if ! printf '%s' "$COMMAND" | grep -qE '\bgit[[:space:]]+commit\b'; then
  verdict_bypass "$HOOK_ID" "not a git commit"
fi
if ! printf '%s' "$COMMAND" | grep -qE '[[:space:]]-m\b'; then
  verdict_bypass "$HOOK_ID" "git commit without -m (editor flow handles enforcement)"
fi

# Exempt amend/fixup operations
if printf '%s' "$COMMAND" | grep -qE '(--amend|--fixup)'; then
  verdict_bypass "$HOOK_ID" "amend/fixup uses existing message"
fi

# Extract the -m argument. Handle both `-m "msg"` and `-m 'msg'` and `-m msg`.
# Use sed to pull just the argument right after -m. This is heuristic — the
# bash parser is more nuanced — but covers 99% of real invocations.
MESSAGE=""
# Try: -m "..."
MESSAGE=$(printf '%s' "$COMMAND" | sed -nE "s/.*-m[[:space:]]+\"([^\"]*)\".*/\1/p" | head -1)
if [ -z "$MESSAGE" ]; then
  # Try: -m '...'
  MESSAGE=$(printf '%s' "$COMMAND" | sed -nE "s/.*-m[[:space:]]+'([^']*)'.*/\1/p" | head -1)
fi
if [ -z "$MESSAGE" ]; then
  # Try: -m word (no quotes — unusual but possible)
  MESSAGE=$(printf '%s' "$COMMAND" | sed -nE "s/.*-m[[:space:]]+([^[:space:]]+).*/\1/p" | head -1)
fi

if [ -z "$MESSAGE" ]; then
  verdict_bypass "$HOOK_ID" "couldn't extract commit message"
fi

# First line is the header
HEADER=$(printf '%s' "$MESSAGE" | head -1)

# Exempt git-built-in subjects (Merge, Revert)
if printf '%s' "$HEADER" | grep -qE '^(Merge|Revert)\b'; then
  verdict_allow "$HOOK_ID" "git-builtin subject ($HEADER)"
fi

# Check conventional format: type(scope?): description
CONVENTIONAL_REGEX="^(${VALID_TYPES})(\\([^)]+\\))?:[[:space:]]+.+"

if ! printf '%s' "$HEADER" | grep -qE "$CONVENTIONAL_REGEX"; then
  verdict_block "$HOOK_ID" "Conventional Commits format required: '<type>: <description>' or '<type>(<scope>): <description>'. Valid types: ${VALID_TYPES//|/, }. Got: '$HEADER'"
fi

# Header length check (commitlint standard: 72 chars max)
HEADER_LEN=${#HEADER}
if [ "$HEADER_LEN" -gt 72 ]; then
  verdict_block "$HOOK_ID" "Commit header exceeds 72 characters ($HEADER_LEN chars). Header: '$HEADER'. Trim to ≤72 chars; put detail in the body."
fi

verdict_allow "$HOOK_ID" "valid conventional commit"
