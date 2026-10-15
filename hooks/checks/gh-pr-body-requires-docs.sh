#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-requires-docs.sh
#
# **Hook**: gh-pr-body-requires-docs
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: docs/agent-guide-baseline.md "Docs With Every Change"
#                  + templates/AGENTS.md
#
# Blocks `gh pr create` / `gh pr edit` when the PR body has neither:
#   - a `## Docs` section (the docs this PR changed), nor
#   - a `Docs: none — <reason>` line (reason of at least 3 characters).
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_REQUIRES_DOCS=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"
# shellcheck source=../lib/gh-pr-body-from-command.sh
source "$__HOOK_LIB_DIR/gh-pr-body-from-command.sh"

readonly HOOK_ID="gh-pr-body-requires-docs"

if [ "${HOOK_BYPASS_GH_PR_BODY_REQUIRES_DOCS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_REQUIRES_DOCS=1"
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

# Act only on a real `gh pr create|edit` command, not a quoted mention.
if ! gh_in_command_position "$COMMAND" 'pr[[:space:]]+(create|edit)'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

REPO_DIR="$(json_get "$INPUT" '.cwd')"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(pwd -P)"
fi

BODY="$(gh_pr_body_text "$COMMAND" "$REPO_DIR" || true)"
if [ -z "$BODY" ]; then
  verdict_bypass "$HOOK_ID" "no --body or readable --body-file"
fi

# Inline --body from hook JSON often carries literal \n instead of newlines.
BODY="$(printf '%b' "$BODY")"

HAS_DOCS_SECTION=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+Docs[[:space:]]*$' || true)
HAS_DOCS_NONE=$(printf '%s' "$BODY" | grep -ciE '^[[:space:]*_-]*Docs:[[:space:]]*none[[:space:]]*(—|--|-|:)[[:space:]]*[^[:space:]].{2,}' || true)

if [ "$HAS_DOCS_SECTION" -ge 1 ] || [ "$HAS_DOCS_NONE" -ge 1 ]; then
  verdict_allow "$HOOK_ID" "PR body states its docs"
fi

verdict_block "$HOOK_ID" "PR body has no ## Docs section. Every change updates its docs in the same PR.
Add one of:
  ## Docs
  - README.md: <what changed>
or, when no doc applies:
  Docs: none — <reason>
Contract: agentbrew docs/agent-guide-baseline.md § Docs With Every Change.
Bypass: HOOK_BYPASS_GH_PR_BODY_REQUIRES_DOCS=1."
