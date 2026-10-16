#!/bin/bash
# Test fixture for checks/goal-retro-before-stop.sh
#
# Builds a state folder and fake transcripts, pipes Stop fixture JSON to the
# hook, and asserts the exit code and the state cleanup.
# Run: `bash goal-retro-before-stop.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/goal-retro-before-stop.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export RUN_GOAL_STATE_DIR="$ROOT/state"
mkdir -p "$RUN_GOAL_STATE_DIR"

TX="$ROOT/t.jsonl"
jq -cn '{type:"assistant",message:{content:[{type:"tool_use",name:"Skill",input:{skill:"run-goal"}}]}}' >"$TX"
jq -cn '{type:"assistant",message:{content:[{type:"tool_use",name:"Read",input:{file_path:"/repo/.claude/skills/write-changelog/SKILL.md"}}]}}' >>"$TX"

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected $expected, got $actual")
  fi
}
run() {
  jq -cn --arg s "$1" --arg p "$TX" '{hook_event_name:"Stop",session_id:$s,transcript_path:$p}' |
    env ${2:-X=1} bash "$SCRIPT" >/dev/null 2>&1
  echo $?
}
has() { [ -f "$RUN_GOAL_STATE_DIR/$1" ] && echo 1 || echo 0; }

expect "no contract allows" 0 "$(run s0)"

touch "$RUN_GOAL_STATE_DIR/s1.contract.md"
expect "no retro blocks" 2 "$(run s1)"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: not updated, commit 1234567 later\n' >"$RUN_GOAL_STATE_DIR/s1.retro.md"
expect "run-goal 'not updated' still blocks" 2 "$(run s1)"
# A live retro (2026-10-16) wrote this for run-goal and the gate let it pass.
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: no new edit. Eval 11 (commit 1fcff84) already covers this exact scenario.\n' >"$RUN_GOAL_STATE_DIR/s1.retro.md"
expect "run-goal 'no new edit ... already covers' still blocks" 2 "$(run s1)"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: new eval, PR #130\n' >"$RUN_GOAL_STATE_DIR/s1.retro.md"
expect "every skill with evidence allows" 0 "$(run s1)"
expect "contract removed on success" 0 "$(has s1.contract.md)"
expect "counter removed on success" 0 "$(has s1.stopblocks)"
expect "retro kept for review" 1 "$(has s1.retro.md)"

touch "$RUN_GOAL_STATE_DIR/s2.contract.md"
printf -- '- run-goal: task run-goal-eval-123\n' >"$RUN_GOAL_STATE_DIR/s2.retro.md"
expect "skill read via SKILL.md must be listed" 2 "$(run s2)"
expect "second block" 2 "$(run s2)"
expect "third block" 2 "$(run s2)"
expect "gives up after three blocks" 0 "$(run s2)"
expect "contract removed after giving up" 0 "$(has s2.contract.md)"

touch "$RUN_GOAL_STATE_DIR/s3.contract.md"
expect "bypass allows" 0 "$(run s3 HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1)"
expect "unsafe session id allows" 0 "$(run '../x')"

echo "goal-retro-before-stop.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
