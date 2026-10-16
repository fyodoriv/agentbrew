#!/bin/bash
# Test fixture for checks/goal-contract-before-edit.sh
#
# Builds a marker folder and fake transcripts, pipes PreToolUse fixture JSON
# to the hook, and asserts the exit code and the marker cleanup.
# Run: `bash goal-contract-before-edit.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/goal-contract-before-edit.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export RUN_GOAL_STATE_DIR="$ROOT/state"
export RUN_GOAL_CONTRACT_WAIT_TENTHS=0
mkdir -p "$RUN_GOAL_STATE_DIR"

NO_CONTRACT="$ROOT/no-contract.jsonl"
WITH_CONTRACT="$ROOT/with-contract.jsonl"
jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Looking at the repo."}]}}' >"$NO_CONTRACT"
jq -cn '{type:"user",message:{content:"/goal fix it. Done when tests pass"}}' >>"$NO_CONTRACT"
cp "$NO_CONTRACT" "$WITH_CONTRACT"
jq -cn '{type:"assistant",message:{content:[{type:"text",text:"## Goal contract\n**Done when**\n1. npm test exits 0\n**Metric**: failing tests 1 -> 0\n- Success: 0 · Pivot: still failing after 2 fixes"}]}}' >>"$WITH_CONTRACT"
MENTION_ONLY="$ROOT/mention-only.jsonl"
cp "$NO_CONTRACT" "$MENTION_ONLY"
jq -cn '{type:"assistant",message:{content:[{type:"text",text:"The hook looks for \"Done when\" in my messages."}]}}' >>"$MENTION_ONLY"
jq -cn '{type:"assistant",message:{content:[{type:"thinking",thinking:"Done when tests pass. Metric failing count. Pivot after 2 tries."}]}}' >>"$MENTION_ONLY"

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected $expected, got $actual")
  fi
}

# Usage: run <session> <tool> <transcript> [extra env assignment]
run() {
  jq -cn --arg s "$1" --arg t "$2" --arg p "$3" \
    '{hook_event_name:"PreToolUse",session_id:$s,tool_name:$t,transcript_path:$p,tool_input:{file_path:"/tmp/x"}}' |
    env ${4:-X=1} bash "$SCRIPT" >/dev/null 2>&1
  echo $?
}

touch "$RUN_GOAL_STATE_DIR/s1.pending"
expect "edit before contract blocks" 2 "$(run s1 Edit "$NO_CONTRACT")"
expect "write before contract blocks" 2 "$(run s1 Write "$NO_CONTRACT")"
expect "contract only in user text still blocks" 2 "$(run s1 Edit "$NO_CONTRACT")"
expect "prose mention or thinking still blocks" 2 "$(run s1 Edit "$MENTION_ONLY")"
expect "Bash is not gated" 0 "$(run s1 Bash "$NO_CONTRACT")"
expect "bypass allows" 0 "$(run s1 Edit "$NO_CONTRACT" HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT=1)"
expect "edit after contract allows" 0 "$(run s1 Edit "$WITH_CONTRACT")"
expect "marker removed after contract" 0 "$([ -f "$RUN_GOAL_STATE_DIR/s1.pending" ] && echo 1 || echo 0)"
expect "no marker allows" 0 "$(run s2 Edit "$NO_CONTRACT")"
expect "missing transcript blocks while pending" 2 "$(touch "$RUN_GOAL_STATE_DIR/s3.pending"; run s3 Edit "$ROOT/missing.jsonl")"
touch -t 202001010000 "$RUN_GOAL_STATE_DIR/s3.pending"
expect "stale marker allows" 0 "$(run s3 Edit "$NO_CONTRACT")"
expect "stale marker removed" 0 "$([ -f "$RUN_GOAL_STATE_DIR/s3.pending" ] && echo 1 || echo 0)"
expect "unsafe session id allows" 0 "$(run '../x' Edit "$NO_CONTRACT")"

# Late flush: the contract lands in the transcript after the hook starts.
LATE="$ROOT/late.jsonl"
cp "$NO_CONTRACT" "$LATE"
touch "$RUN_GOAL_STATE_DIR/s4.pending"
(sleep 0.5; tail -1 "$WITH_CONTRACT" >>"$LATE") &
expect "contract flushed late allows" 0 "$(run s4 Edit "$LATE" RUN_GOAL_CONTRACT_WAIT_TENTHS=20)"
wait

echo "goal-contract-before-edit.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
