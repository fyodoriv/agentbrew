#!/bin/bash
# agentbrew/hooks/checks/start-refused-caught.sh
#
# **Hook**: start-refused-caught
# **Event**: PostToolUse on Bash
# **Verdict**: block (tells the agent; the command already ran)
# **Source rule**: shared-rules.md "Fast, safe iterations": confirm a start is alive before you report it.
#
# A launcher can refuse a start (a lock is held, a run is already going) and still print a success
# line. On 2026-11-22 `sidequest gifts refill` refused 8 of 9 starts this way. This hook reads the
# output of each Bash call and stops the agent when it says the start did not happen.
#
# Fires on: "already running", "lock held", "is locked", "another run", "refused", "skipped: running",
# `"state":"running"` from a start that was not ours, "could not acquire lock".
# Bypass: HOOK_BYPASS_START_REFUSED_CAUGHT=1.
# Test: bash start-refused-caught.test.sh

set -euo pipefail
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="start-refused-caught"
if [ "${HOOK_BYPASS_START_REFUSED_CAUGHT:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_START_REFUSED_CAUGHT=1"
fi

INPUT="$(read_hook_stdin)"
[ "$(json_get "$INPUT" '.tool_name')" = "Bash" ] || verdict_bypass "$HOOK_ID" "not Bash"
CMD="$(json_get "$INPUT" '.tool_input.command')"
# Only starts: a detach, a known launcher, or a background call. Reads (grep, cat, rg) are skipped.
if ! grep -qE 'nohup|setsid|disown|&[[:space:]]*($|;)|refill|ship\.sh|claude -p|[[:space:]](start|run|launch|spawn)([[:space:]]|$)' <<<"$CMD" \
  && [ "$(json_get "$INPUT" '.tool_input.run_in_background')" != "true" ]; then
  verdict_allow "$HOOK_ID" "not a start"
fi
if grep -qE '^[[:space:]]*(rg|grep|cat|less|head|tail|sed|jq|git (log|show|diff|grep))[[:space:]]' <<<"$CMD"; then
  verdict_allow "$HOOK_ID" "a read"
fi
OUT="$(jq -r '[.tool_response.stdout?, .tool_response.stderr?, (.tool_response|strings)?] | map(select(.)) | join("\n")' <<<"$INPUT" 2>/dev/null || true)"
HIT="$(grep -iEo 'already running|lock (is )?held|is locked|could not acquire( the)? lock|another (run|instance)[^.]{0,40}(running|in progress)|start refused|refused to start|skipped[: ]+(already )?running|"state" *: *"(running|locked|refused|busy)"' <<<"$OUT" | head -1 || true)"
[ -n "$HIT" ] || verdict_allow "$HOOK_ID" "no refusal"
verdict_block "$HOOK_ID" "the output says \"$HIT\": this start was probably refused, and an older run (or none) is what is running. Do not report it as started. Check the real process (its pid with kill -0, its lock file, or a fresh log line), wait for the running one to end or start one run that covers all the work, then say exactly how many runs are live."
