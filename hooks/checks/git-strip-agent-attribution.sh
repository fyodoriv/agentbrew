#!/bin/bash
# agentbrew/hooks/checks/git-strip-agent-attribution.sh
#
# **Hook**: git-strip-agent-attribution
# **Event**: PreToolUse on Bash
# **Verdict**: warn (the dotfiles/git-hooks/commit-msg hook handles the
#              actual strip + footer-append; this hook surfaces the
#              attribution to the agent so it knows it'll be rewritten)
# **Source rule**: dotfiles/git-hooks/commit-msg + dotfiles/lib/strip-agent-attribution.sh
#
# Detects when `git commit -m "..."` contains foreign agent attribution
# (Co-Authored-By: Claude / Devin / Cursor / etc., or "Generated with
# [Agent](...)" footers). The actual strip + Fyodor-footer append happens
# in the dotfiles/git-hooks/commit-msg hook downstream. This Claude Code
# hook's job is visibility: the agent sees the warning + knows the
# attribution will be rewritten.
#
# This is the broader, file-level layer of attribution enforcement:
#   - dotfiles/bin/gh — wraps gh pr/issue body
#   - dotfiles/git-hooks/commit-msg — wraps git commit (editor flow)
#   - This hook — wraps git commit -m INSIDE Claude Code's Bash tool
#   - gh-pr-body-attribution.sh — wraps gh pr/issue INSIDE Claude Code's Bash tool
#
# **Bypass**: `HOOK_BYPASS_GIT_STRIP_AGENT_ATTRIBUTION=1` (informational
# warn — rarely needed). Bypass MINSKY_PIPELINE=1 also honored, matching
# the dotfiles/lib/strip-agent-attribution.sh policy.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="git-strip-agent-attribution"

if [ "${HOOK_BYPASS_GIT_STRIP_AGENT_ATTRIBUTION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GIT_STRIP_AGENT_ATTRIBUTION=1"
fi
if [ -n "${MINSKY_PIPELINE:-}" ]; then
  verdict_bypass "$HOOK_ID" "MINSKY_PIPELINE=1 — orchestrator-managed attribution"
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

# Only fire on git commit (-m or editor flow)
if ! printf '%s' "$COMMAND" | grep -qE '\bgit[[:space:]]+commit\b'; then
  verdict_bypass "$HOOK_ID" "not git commit"
fi

# Use the shared regex
# shellcheck source=../lib/strip-agent-attribution.sh
source "$__HOOK_LIB_DIR/strip-agent-attribution.sh"
COMBINED_RE=$(_agent_attr_combined_re)

if printf '%s' "$COMMAND" | grep -iqE "$COMBINED_RE"; then
  verdict_warn "$HOOK_ID" "git commit contains foreign agent attribution. The dotfiles/git-hooks/commit-msg hook will strip vendor-specific trailers (Co-Authored-By: <agent>, Generated with [<agent>]) and append the canonical Fyodor footer. To silence: omit the explicit agent attribution from -m messages — the footer is added automatically."
fi

verdict_allow "$HOOK_ID" "no foreign attribution detected"
