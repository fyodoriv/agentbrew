#!/bin/bash
# agentbrew/hooks/checks/verify-before-completion.sh
#
# **Hook**: verify-before-completion
# **Event**: Stop
# **Verdict**: block
# **Source rule**: shared-rules.md:231 "Verify Before Completion (IRON LAW)"
#
# At the end of every agent turn (Stop event), check the transcript for
# evidence that verification was actually run. If the agent modified code
# files (Write/Edit on *.ts/.tsx/.js/.jsx/.py/.sh) but never completed a
# verify command (npm test / npx vitest / tsc / npm run build /
# npm run verify / pytest / shellcheck), BLOCK the Stop — the agent
# can't claim "done" without empirical proof.
#
# **What gets blocked**:
#   - Agent edits 3 .ts files, never runs `tsc` or tests, tries to Stop → block
#   - Agent rewrites a Python module, never runs pytest → block
#   - Agent updates a bash script, never runs `shellcheck` or `bats` → block
#
# **What does NOT get blocked**:
#   - Read-only sessions (no Write/Edit calls)
#   - Pure docs / markdown sessions (no code-shaped files touched)
#   - A successful foreground check after the latest code edit
#   - An explicit hosted run watch that reports success for the same run ID
#
# **Bypass**: `HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1` for the genuinely
# read-only sessions that the heuristic miscategorizes (rare). Or
# explicitly skip with `MINSKY_PIPELINE=1` for orchestrator-driven runs
# that have their own verify gate downstream.
#
# **Heuristic**: parses the transcript JSONL file for tool_use entries.
# Counts Write/Edit on code files and successful verify results. Best-
# effort — false negatives (allowed when shouldn't be) are preferable to
# false positives (blocked legitimate work). Cron-wired auto-heal could
# tighten this later.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="verify-before-completion"

if [ "${HOOK_BYPASS_VERIFY_BEFORE_COMPLETION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1"
fi
if [ -n "${MINSKY_PIPELINE:-}" ]; then
  verdict_bypass "$HOOK_ID" "MINSKY_PIPELINE=1 — orchestrator-owned verify"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"

# Only fire on Stop event
if [ "$HOOK_EVENT_NAME" != "Stop" ]; then
  verdict_bypass "$HOOK_ID" "not a Stop event"
fi

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  verdict_bypass "$HOOK_ID" "no transcript path (best-effort)"
fi

# The parser counts this turn's edits and matches checks to successful results.
COUNTS="$(hook_jq -nr -f "$__HOOK_LIB_DIR/verification-results.jq" "$TRANSCRIPT_PATH" 2>/dev/null)" ||
  verdict_bypass "$HOOK_ID" "could not read the transcript"
IFS=$'\t' read -r CODE_EDITS VERIFY_CMDS <<< "$COUNTS"

if [ "$CODE_EDITS" = "0" ]; then
  verdict_bypass "$HOOK_ID" "no code-file edits this turn"
fi

if [ "$VERIFY_CMDS" = "0" ]; then
  verdict_block "$HOOK_ID" "Verify Before Completion: found $CODE_EDITS code edit(s) and no successful check result. Use the gate in the project guide. For a hosted gate, read the exact run once it ends with bash $__HOOK_LIB_DIR/ci-watch-fail-fast.sh <run-id>."
fi

verdict_allow "$HOOK_ID" "verified ($VERIFY_CMDS verify cmd(s) for $CODE_EDITS code edit(s))"
