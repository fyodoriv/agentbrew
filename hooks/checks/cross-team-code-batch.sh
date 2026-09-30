#!/bin/bash
# agentbrew/hooks/checks/cross-team-code-batch.sh
#
# **Hook**: cross-team-code-batch
# **Event**: PreToolUse on Bash (gh pr create)
# **Verdict**: warn (block-by-default risk too high — CODEOWNERS parsing has edge cases)
# **Source rule**: shared-rules.md:311 "Cross-Team Code Touches Batch Into a Single Last PR (HIGHEST PRIORITY IRON LAW)"
#
# When `gh pr create` runs, check the staged diff against CODEOWNERS.
# If the diff touches files owned by 2+ different teams AND the PR
# title doesn't start with `[BATCH]` / `[CROSS-TEAM]`, warn the user.
# The rule: cross-team work should be a deliberate single PR explicitly
# tagged so reviewers from each team can be notified — accidental
# cross-team PRs cause unhappy 3-day review delays.
#
# **What triggers a warning**:
#   - `gh pr create` with diff touching files owned by 2+ CODEOWNERS teams
#   - No `[BATCH]` or `[CROSS-TEAM]` prefix in the --title
#
# **What does NOT trigger**:
#   - Single-team PR diff
#   - `gh pr create --title "[BATCH] ..."` (explicit acknowledgment)
#   - No CODEOWNERS file in repo
#
# **Bypass**: `HOOK_BYPASS_CROSS_TEAM_CODE_BATCH=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="cross-team-code-batch"

if [ "${HOOK_BYPASS_CROSS_TEAM_CODE_BATCH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_CROSS_TEAM_CODE_BATCH=1"
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

# Only fire on gh pr create
if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+create\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create"
fi

# Check if title has BATCH/CROSS-TEAM prefix — if so, the agent has
# explicitly acknowledged cross-team, allow.
TITLE=$(printf '%s' "$COMMAND" | sed -nE 's/.*--title[[:space:]]+"([^"]*)".*/\1/p' | head -1)
if [ -z "$TITLE" ]; then
  TITLE=$(printf '%s' "$COMMAND" | sed -nE "s/.*--title[[:space:]]+'([^']*)'.*/\1/p" | head -1)
fi
if printf '%s' "$TITLE" | grep -qiE '^\[(BATCH|CROSS.TEAM)\]'; then
  verdict_bypass "$HOOK_ID" "title has explicit [BATCH]/[CROSS-TEAM] prefix"
fi

# Find CODEOWNERS file
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CODEOWNERS=""
for path in CODEOWNERS .github/CODEOWNERS docs/CODEOWNERS; do
  if [ -f "$REPO_ROOT/$path" ]; then
    CODEOWNERS="$REPO_ROOT/$path"
    break
  fi
done

if [ -z "$CODEOWNERS" ]; then
  verdict_bypass "$HOOK_ID" "no CODEOWNERS file found"
fi

# Get the staged diff file list (cheap)
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null | head -200)
if [ -z "$CHANGED_FILES" ]; then
  # Maybe nothing staged — try diff against origin/main
  CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null | head -200 || true)
fi
if [ -z "$CHANGED_FILES" ]; then
  verdict_bypass "$HOOK_ID" "no changed files detected"
fi

# Extract team owners from CODEOWNERS by matching file paths.
# Heuristic: take the unique set of @org/team patterns mentioned.
# CODEOWNERS file format: <pattern> <owner1> <owner2>
TEAMS_TOUCHED=$(
  while IFS= read -r file; do
    # Find matching CODEOWNERS line — first matching pattern (last in file by spec, but we accept first as heuristic)
    grep -E "$(printf '%s' "$file" | sed 's/[[:punct:]]/\\&/g')|\\*\\*|\\*" "$CODEOWNERS" 2>/dev/null | head -1 | grep -oE '@[a-zA-Z0-9_/-]+'
  done <<<"$CHANGED_FILES" | sort -u
)

TEAM_COUNT=$(printf '%s\n' "$TEAMS_TOUCHED" | grep -c '@' || true)

if [ "$TEAM_COUNT" -ge 2 ]; then
  TEAMS_LIST=$(printf '%s' "$TEAMS_TOUCHED" | tr '\n' ' ')
  verdict_warn "$HOOK_ID" "Cross-Team Code Touches Batch (HIGHEST PRIORITY IRON LAW): PR diff touches $TEAM_COUNT teams ($TEAMS_LIST).
Either: (a) prefix the PR title with [BATCH] / [CROSS-TEAM] so reviewers from each team get notified, or (b) split the PR by team. Bypass: HOOK_BYPASS_CROSS_TEAM_CODE_BATCH=1."
fi

verdict_allow "$HOOK_ID" "single-team PR or low team count"
