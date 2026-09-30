#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-attribution.sh
#
# **Hook**: gh-pr-body-attribution
# **Event**: PreToolUse on Bash
# **Verdict**: warn (Claude Code PreToolUse can't mutate tool_input cleanly;
#              the dotfiles/bin/gh wrapper handles the actual mutation
#              before the real gh CLI runs)
# **Source rule**: shared-rules.md:1283 "Agent Attribution Footer (ABSOLUTE)"
#                  + dotfiles/bin/gh wrapper logic
#
# Detects when `gh pr create/edit --body "..."` contains foreign agent
# attribution (Co-Authored-By: Claude / Devin / Cursor / etc., or
# "Generated with [Agent](...)" footers). The actual STRIP happens in
# the dotfiles/bin/gh wrapper which runs after this hook. This hook's
# job is to surface a warning to the agent that its attribution is
# about to be stripped — that visibility is the point.
#
# **What gets warned-on**:
#   - `--body "...Co-Authored-By: Claude <noreply@anthropic.com>..."`
#   - `--body "...Generated with [Claude Code](...)"`
#   - `--body "...Co-Authored-By: devin-ai-integration[bot]..."`
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_ATTRIBUTION=1` (rarely needed —
# the warn is informational).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-body-attribution"

if [ "${HOOK_BYPASS_GH_PR_BODY_ATTRIBUTION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_ATTRIBUTION=1"
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

# Only fire on gh pr create / edit / comment / review with --body
if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+(pr|issue)[[:space:]]+(create|edit|comment|review)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr/issue body command"
fi

# Source the shared agent-attribution detection regex
# shellcheck source=../lib/strip-agent-attribution.sh
source "$__HOOK_LIB_DIR/strip-agent-attribution.sh"

# Check the entire command for known agent attribution patterns. We don't
# bother extracting the --body arg precisely here; if any attribution
# pattern appears in the command at all, that's our signal. (The dotfiles
# bin/gh wrapper does the precise extraction + strip downstream.)
COMBINED_RE=$(_agent_attr_combined_re)

if printf '%s' "$COMMAND" | grep -iqE "$COMBINED_RE"; then
  verdict_warn "$HOOK_ID" "PR body contains foreign agent attribution (Co-Authored-By: <agent> or 'Generated with [<agent>]'). The dotfiles/bin/gh wrapper will strip these before posting + append the canonical Fyodor footer. To silence this warning: write your PR body without explicit agent footers."
fi

verdict_allow "$HOOK_ID" "no foreign attribution detected"
