#!/bin/bash
# Test fixture for checks/goal-contract-before-edit.sh
#
# Builds a state folder, pipes PreToolUse fixture JSON to the hook, and
# asserts the exit code, the contract-file approval, and the marker cleanup.
# Run: `bash goal-contract-before-edit.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/goal-contract-before-edit.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export RUN_GOAL_STATE_DIR="$ROOT/state"
mkdir -p "$RUN_GOAL_STATE_DIR"

GOOD=$'## Goal contract\n**Done when**\n1. npm test exits 0\n**Metric**: failing tests 1 -> 0\n- Success: 0 · Pivot: still failing after 2 fixes'
WEAK=$'## Goal contract\n**Done when**\n1. tests pass'

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected $expected, got $actual")
  fi
}

# Usage: run <session> <tool> <file_path> [content] [extra env assignment]; prints "<exit>:<stdout>"
run() {
  local out code
  out="$(jq -cn --arg s "$1" --arg t "$2" --arg f "$3" --arg c "${4:-}" \
    '{hook_event_name:"PreToolUse",session_id:$s,tool_name:$t,tool_input:{file_path:$f,content:$c}}' |
    env ${5:-X=1} bash "$SCRIPT" 2>/dev/null)"
  code=$?
  printf '%s:%s' "$code" "$out"
}
code_of() { printf '%s' "${1%%:*}"; }
pending() { [ -f "$RUN_GOAL_STATE_DIR/$1.pending" ] && echo 1 || echo 0; }

C1="$RUN_GOAL_STATE_DIR/s1.contract.md"
touch "$RUN_GOAL_STATE_DIR/s1.pending"
expect "edit before contract blocks" 2 "$(code_of "$(run s1 Edit /repo/a.js)")"
expect "write before contract blocks" 2 "$(code_of "$(run s1 Write /repo/a.js x)")"
expect "Bash is not gated" 0 "$(code_of "$(run s1 Bash /repo/a.js)")"
expect "bypass allows" 0 "$(code_of "$(run s1 Edit /repo/a.js "" HOOK_BYPASS_GOAL_CONTRACT_BEFORE_EDIT=1)")"
expect "weak contract file blocks" 2 "$(code_of "$(run s1 Write "$C1" "$WEAK")")"
expect "still pending after weak contract" 1 "$(pending s1)"
OUT="$(run s1 Write "$C1" "$GOOD")"
expect "good contract file write allowed" 0 "$(code_of "$OUT")"
expect "contract write is auto-approved" 1 "$(printf '%s' "${OUT#*:}" | jq -e '.hookSpecificOutput.permissionDecision == "allow"' >/dev/null 2>&1 && echo 1 || echo 0)"
expect "marker removed after contract write" 0 "$(pending s1)"
expect "edit after contract allows" 0 "$(code_of "$(run s1 Edit /repo/a.js)")"

# Marker pending, contract file already on disk (written earlier in the session).
touch "$RUN_GOAL_STATE_DIR/s2.pending"
printf '%s\n' "$GOOD" >"$RUN_GOAL_STATE_DIR/s2.contract.md"
expect "existing contract file allows" 0 "$(code_of "$(run s2 Edit /repo/a.js)")"
expect "existing contract clears marker" 0 "$(pending s2)"

expect "no marker allows" 0 "$(code_of "$(run s9 Edit /repo/a.js)")"
touch "$RUN_GOAL_STATE_DIR/s3.pending"
touch -t 202001010000 "$RUN_GOAL_STATE_DIR/s3.pending"
expect "stale marker allows" 0 "$(code_of "$(run s3 Edit /repo/a.js)")"
expect "stale marker removed" 0 "$(pending s3)"
expect "unsafe session id allows" 0 "$(code_of "$(run '../x' Edit /repo/a.js)")"
touch "$RUN_GOAL_STATE_DIR/s4.pending"
expect "contract path of another session does not count" 2 "$(code_of "$(run s4 Write "$C1" "$GOOD")")"

echo "goal-contract-before-edit.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
