#!/bin/bash
# agentbrew/hooks/checks/no-git-add-all.sh
#
# **Hook**: no-git-add-all
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Git Safety (Multi-Agent)" + agentbrew/AGENTS.md
#
# Blocks `git add -A`, `git add .`, `git add --all`, `git add -u`. Multi-
# agent sessions share the same working tree; staging ALL changes
# captures other agents' work-in-progress + breaks isolation. The
# canonical alternative is `git add <specific-files>` enumerated by
# the agent itself.
#
# **What gets blocked**:
#   - `git add -A`
#   - `git add .`
#   - `git add --all`
#   - `git add -u` / `git add --update`
#   - `git add -p` is allowed (interactive patch — agent typically can't drive it but it's not destructive)
#
# **Bypass**: `HOOK_BYPASS_NO_GIT_ADD_ALL=1` for the rare case where
# add-all IS the right move (initial commit of a fresh repo, e.g.).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-git-add-all"

if [ "${HOOK_BYPASS_NO_GIT_ADD_ALL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_GIT_ADD_ALL=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Only fire on Bash
if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command to check"
fi

# Match git add -A | git add . | git add --all | git add -u | git add --update
# Anchor at word boundary so we don't match `git add -All-Other-File.txt`.
ADD_ALL_REGEX='\bgit[[:space:]]+add[[:space:]]+(-A\b|\.[[:space:]]|\.$|--all\b|-u\b|--update\b)'

if printf '%s' "$COMMAND" | grep -qE "$ADD_ALL_REGEX"; then
  verdict_block "$HOOK_ID" "git add -A / git add . / git add -u stages ALL working-tree changes including other agents' WIP. Multi-agent rule: enumerate specific files (\`git add <file1> <file2> ...\`). Bypass: HOOK_BYPASS_NO_GIT_ADD_ALL=1 (only for initial-commit-of-fresh-repo scenarios)."
fi

verdict_allow "$HOOK_ID" "no add-all pattern detected"
