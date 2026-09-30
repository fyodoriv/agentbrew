#!/bin/bash
# agentbrew/hooks/checks/gh-pr-body-requires-rationale.sh
#
# **Hook**: gh-pr-body-requires-rationale
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md:504 "PR Format (canonical structure + brevity is IRON LAW)"
#                  + dotfiles/bin/gh wrapper (formalized as hook 2026-05-27)
#
# Blocks `gh pr create` / `gh pr edit` when the PR body lacks ANY of:
#   - A "## Summary" / "## Why" / "## What changed" section header
#   - The word "because" / "rationale" / "fixes" / "addresses"
#   - A Jira / GitHub issue link (PROJ-, SOLID-, #123)
#
# These signals are pure regex — they don't VERIFY the rationale is good,
# they just verify SOMETHING-like-rationale exists. The LLM-verifier hook
# (gh-pr-body-explains-why, Cat B Phase 2) does the semantic check.
#
# **What gets blocked**:
#   - `gh pr create --body "ship it"` (no rationale signal)
#   - `gh pr create --body "fixed the bug"` (no Why/Summary header, no ticket)
#
# **What does NOT get blocked**:
#   - `gh pr create --body "## Summary\n\nFix the foo because the bar broke"` (has structure + because)
#   - `gh pr create --body "PROJ-123: handle empty array case"` (has ticket ref)
#   - Empty body (PR creator omitted it — separate enforcement path)
#
# **Bypass**: `HOOK_BYPASS_GH_PR_BODY_REQUIRES_RATIONALE=1` for the
# emergency-fix PRs where you'll add the rationale post-creation.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-body-requires-rationale"

if [ "${HOOK_BYPASS_GH_PR_BODY_REQUIRES_RATIONALE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_BODY_REQUIRES_RATIONALE=1"
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

# Only fire on gh pr create / gh pr edit
if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|edit)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

# Extract the --body argument. Handles --body "...", --body '...', and
# --body-file paths (skipped — we don't read the file, just block on
# missing body — the file-based version typically has structure).
BODY=""
BODY=$(printf '%s' "$COMMAND" | sed -nE "s/.*--body[[:space:]]+\"([^\"]*)\".*/\1/p" | head -1)
if [ -z "$BODY" ]; then
  BODY=$(printf '%s' "$COMMAND" | sed -nE "s/.*--body[[:space:]]+'([^']*)'.*/\1/p" | head -1)
fi
if [ -z "$BODY" ]; then
  # --body-file — assume the file has structure; skip the check
  if printf '%s' "$COMMAND" | grep -qE '\-\-body-file\b'; then
    verdict_bypass "$HOOK_ID" "--body-file used (trusted to have structure)"
  fi
  # No --body at all — let gh handle (it'll prompt). Don't block here.
  verdict_bypass "$HOOK_ID" "no --body arg detected"
fi

# Check for rationale signals
HAS_SECTION_HEADER=$(printf '%s' "$BODY" | grep -ciE '^##[[:space:]]+(Summary|Why|What changed|Motivation|Context|Background)' || true)
HAS_RATIONALE_WORDS=$(printf '%s' "$BODY" | grep -ciE '\b(because|rationale|addresses|fixes|closes|resolves|so that|in order to|to prevent)\b' || true)
HAS_TICKET=$(printf '%s' "$BODY" | grep -ciE '\b[A-Z][A-Z0-9]+-[0-9]+\b|#[0-9]+\b' || true)

if [ "$HAS_SECTION_HEADER" = "0" ] && [ "$HAS_RATIONALE_WORDS" = "0" ] && [ "$HAS_TICKET" = "0" ]; then
  verdict_block "$HOOK_ID" "PR body lacks rationale signal. Add ONE of:
  (a) A '## Summary' / '## Why' / '## What changed' section header.
  (b) A rationale word ('because', 'addresses', 'fixes', 'closes', 'resolves').
  (c) A ticket reference (PROJ-XXX, SOLID-XXX, #123).
PRs without rationale are reviewer noise (shared-rules.md IRON LAW). Bypass: HOOK_BYPASS_GH_PR_BODY_REQUIRES_RATIONALE=1."
fi

verdict_allow "$HOOK_ID" "rationale signal present"
