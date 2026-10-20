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
# The goal may still be running after a retro passes (a mid-goal retro);
# the contract is the goal's record, so a Stop never deletes it.
expect "contract kept on success" 1 "$(has s1.contract.md)"
expect "counter removed on success" 0 "$(has s1.stopblocks)"
expect "retro kept for review" 1 "$(has s1.retro.md)"
expect "a later Stop with the same retro still allows" 0 "$(run s1)"
expect "contract still kept after a second passing Stop" 1 "$(has s1.contract.md)"
# Work goes on and uses a new skill: the gate must still see it.
jq -cn '{type:"assistant",message:{content:[{type:"tool_use",name:"Skill",input:{skill:"code-review"}}]}}' >>"$TX"
expect "a skill used after the retro blocks again" 2 "$(run s1)"
printf -- '- code-review: Step 6a test, PR #171\n' >>"$RUN_GOAL_STATE_DIR/s1.retro.md"
expect "listing the new skill allows again" 0 "$(run s1)"

touch "$RUN_GOAL_STATE_DIR/s2.contract.md"
printf -- '- run-goal: task run-goal-eval-123\n' >"$RUN_GOAL_STATE_DIR/s2.retro.md"
expect "skill read via SKILL.md must be listed" 2 "$(run s2)"
expect "second block" 2 "$(run s2)"
expect "third block" 2 "$(run s2)"
expect "gives up after three blocks" 0 "$(run s2)"
expect "contract kept after giving up" 1 "$(has s2.contract.md)"
expect "stays given up on the next Stop" 0 "$(run s2)"

# Issue #305: a goal that waits on background workers ends turns mid-goal.
# The retro belongs at the end, so the hook must not block while a launched
# background task has no completion notification yet.
TX_SAVE="$TX"
TX="$ROOT/bg.jsonl"
cp "$TX_SAVE" "$TX"
touch "$RUN_GOAL_STATE_DIR/s4.contract.md"
bg_launch() { # $1 tool_use id, $2 result text
  jq -cn --arg i "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:$i,name:"Agent",input:{prompt:"w"}}]}}' >>"$TX"
  jq -cn --arg i "$1" --arg t "$2" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:$i,content:[{type:"text",text:$t}]}]}}' >>"$TX"
}
bg_done() {
  jq -cn --arg i "$1" '{type:"user",message:{content:("<task-notification>\n<task-id>x</task-id>\n<tool-use-id>" + $i + "</tool-use-id>\n<status>completed</status>")}}' >>"$TX"
}
bg_launch toolu_a "Async agent launched successfully."
bg_launch toolu_b "Async agent launched successfully."
bg_launch toolu_c "Command running in background with ID: b1. Output is being written to: /x"
expect "three running workers: no retro demanded" 0 "$(run s4)"
expect "waiting does not count as a block" 0 "$(has s4.stopblocks)"
bg_done toolu_a
bg_done toolu_b
expect "one worker still running allows" 0 "$(run s4)"
bg_done toolu_c
expect "all workers done: retro demanded again" 2 "$(run s4)"
TX="$TX_SAVE"

touch "$RUN_GOAL_STATE_DIR/s3.contract.md"
expect "bypass allows" 0 "$(run s3 HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1)"
expect "unsafe session id allows" 0 "$(run '../x')"

echo "goal-retro-before-stop.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
