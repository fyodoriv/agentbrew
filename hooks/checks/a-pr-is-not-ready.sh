#!/bin/bash
# agentbrew/hooks/checks/a-pr-is-not-ready.sh
#
# **Hook**: a-pr-is-not-ready
# **Event**: Stop
# **Verdict**: block
# **Source rule**: shared-rules.md:645 "A PR Is Not Ready Until It's Rebased and Green (IRON LAW)"
#
# When an agent's turn included a `gh pr create` / `gh pr ready` /
# `gh pr merge` invocation, block the Stop event until the PR is:
#   (a) ahead of base (not behind main)
#   (b) green on CI checks (or pending — never red without explicit acknowledgment)
#
# This catches the canonical "agent claims done, PR is red" failure
# mode. The agent has to either fix the CI failure or explicitly
# acknowledge it before the Stop is allowed.
#
# **What gets blocked**:
#   - Agent ran `gh pr create` 4 turns ago; current PR has 3 failing checks; agent tries to Stop → block
#   - Agent ran `gh pr ready 1234`; PR is behind main by 5 commits; tries to Stop → block
#
# **What does NOT get blocked**:
#   - No `gh pr` activity in this turn — irrelevant
#   - PR has only pending checks (CI still running) — too early to judge
#   - Agent already said "CI failures are expected because X" in transcript — heuristic looks for "ack-red" markers
#
# **Bypass**: `HOOK_BYPASS_A_PR_IS_NOT_READY=1` for the rare case the
# heuristic misfires (very read-only sessions after a PR create).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="a-pr-is-not-ready"

if [ "${HOOK_BYPASS_A_PR_IS_NOT_READY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_A_PR_IS_NOT_READY=1"
fi
if [ -n "${MINSKY_PIPELINE:-}" ]; then
  verdict_bypass "$HOOK_ID" "MINSKY_PIPELINE=1 — orchestrator-owned PR check"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"

if [ "$HOOK_EVENT_NAME" != "Stop" ]; then
  verdict_bypass "$HOOK_ID" "not a Stop event"
fi

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  verdict_bypass "$HOOK_ID" "no transcript path (best-effort)"
fi

# Did this turn include a gh pr create / ready / merge call?
PR_ACTIVITY=$(jq -r 'select(.message.content[]?.type == "tool_use" and .message.content[].name == "Bash")
  | .message.content[] | select(.type == "tool_use" and .name == "Bash")
  | .input.command // empty' "$TRANSCRIPT_PATH" 2>/dev/null \
  | grep -cE '\bgh[[:space:]]+pr[[:space:]]+(create|ready|merge)\b' || true)

if [ "$PR_ACTIVITY" = "0" ] || [ -z "$PR_ACTIVITY" ]; then
  verdict_bypass "$HOOK_ID" "no gh pr create/ready/merge in this turn"
fi

# Find the most recent gh pr number referenced in the transcript
PR_NUM=$(jq -r 'select(.message.content[]?.type == "tool_use" and .message.content[].name == "Bash")
  | .message.content[] | select(.type == "tool_use" and .name == "Bash")
  | .input.command // empty' "$TRANSCRIPT_PATH" 2>/dev/null \
  | grep -oE 'gh[[:space:]]+pr[[:space:]]+(view|ready|merge|edit)[[:space:]]+[0-9]+' \
  | grep -oE '[0-9]+' | tail -1 || true)

if [ -z "$PR_NUM" ]; then
  # Couldn't extract PR number from transcript — best-effort warn
  verdict_warn "$HOOK_ID" "gh pr activity detected but couldn't extract PR number to verify status. Run \`gh pr checks <num>\` manually before claiming done."
fi

# Try to determine the repo from the transcript (gh -R <repo> usage)
REPO=$(jq -r 'select(.message.content[]?.type == "tool_use" and .message.content[].name == "Bash")
  | .message.content[] | select(.type == "tool_use" and .name == "Bash")
  | .input.command // empty' "$TRANSCRIPT_PATH" 2>/dev/null \
  | grep -oE '\-\-repo[[:space:]]+[^[:space:]]+' \
  | head -1 | awk '{print $2}' || true)

# Check PR status. Use a 5s timeout — gh API can stall and we don't want
# to freeze the Stop event. Default-allow on timeout (best-effort).
REPO_ARG=""
if [ -n "$REPO" ]; then
  REPO_ARG="--repo $REPO"
fi

if ! command -v timeout >/dev/null 2>&1; then
  timeout() { gtimeout "$@" 2>/dev/null || "$@"; }
fi

PR_INFO=$(timeout 5 gh pr view "$PR_NUM" $REPO_ARG --json mergeable,mergeStateStatus,statusCheckRollup 2>/dev/null || echo "")

if [ -z "$PR_INFO" ]; then
  verdict_warn "$HOOK_ID" "Couldn't fetch PR #$PR_NUM status (gh timed out or unauthenticated). Run \`gh pr checks $PR_NUM\` manually before claiming done."
fi

# Check for FAILURE conclusions
FAILED=$(echo "$PR_INFO" | jq -r '[.statusCheckRollup[]?.conclusion] | map(select(. == "FAILURE")) | length' 2>/dev/null || echo "0")

if [ "$FAILED" -gt 0 ]; then
  verdict_block "$HOOK_ID" "A PR Is Not Ready (IRON LAW): PR #$PR_NUM has $FAILED failing CI check(s). Run \`gh pr checks $PR_NUM\` to see which. Fix CI before claiming done. If failures are expected (e.g. WIP draft), bypass via HOOK_BYPASS_A_PR_IS_NOT_READY=1 and document the reason in the PR body."
fi

# Check for behind-main / dirty mergeable
MERGE_STATE=$(echo "$PR_INFO" | jq -r '.mergeStateStatus // ""' 2>/dev/null)
case "$MERGE_STATE" in
  "BEHIND")
    verdict_block "$HOOK_ID" "A PR Is Not Ready (IRON LAW): PR #$PR_NUM is BEHIND main. Rebase + push before claiming done: \`git fetch origin main && git rebase origin/main && git push --force-with-lease\`. Bypass: HOOK_BYPASS_A_PR_IS_NOT_READY=1."
    ;;
  "DIRTY")
    verdict_block "$HOOK_ID" "A PR Is Not Ready (IRON LAW): PR #$PR_NUM has merge conflicts. Resolve via rebase before claiming done. Bypass: HOOK_BYPASS_A_PR_IS_NOT_READY=1."
    ;;
esac

verdict_allow "$HOOK_ID" "PR #$PR_NUM ready (no FAILURE, not BEHIND/DIRTY)"
