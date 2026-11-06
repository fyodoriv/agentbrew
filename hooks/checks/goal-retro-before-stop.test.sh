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
touch "$RUN_GOAL_STATE_DIR/issueurl.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: new eval, https://github.com/example/project/issues/123\n' >"$RUN_GOAL_STATE_DIR/issueurl.retro.md"
expect "numeric issue URL allows" 0 "$(run issueurl)"
touch "$RUN_GOAL_STATE_DIR/issuemarkdown.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: new eval, [follow-up](https://github.com/example/project/issues/123)\n' >"$RUN_GOAL_STATE_DIR/issuemarkdown.retro.md"
expect "Markdown numeric issue URL allows" 0 "$(run issuemarkdown)"
touch "$RUN_GOAL_STATE_DIR/issuebad.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: new eval, https://github.com/example/project/issues/\n' >"$RUN_GOAL_STATE_DIR/issuebad.retro.md"
expect "issue URL without number blocks" 2 "$(run issuebad)"
touch "$RUN_GOAL_STATE_DIR/issuenegated.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: no new edit, https://github.com/example/project/issues/123\n' >"$RUN_GOAL_STATE_DIR/issuenegated.retro.md"
expect "negated update with issue URL blocks" 2 "$(run issuenegated)"
touch "$RUN_GOAL_STATE_DIR/taskbare.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: task retro-run-goal-eval\n' >"$RUN_GOAL_STATE_DIR/taskbare.retro.md"
expect "a bare task id blocks: try the write first" 2 "$(run taskbare)"
touch "$RUN_GOAL_STATE_DIR/taskfailed.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: task retro-run-goal-eval, write failed: Operation not permitted\n' >"$RUN_GOAL_STATE_DIR/taskfailed.retro.md"
expect "a task with the failed write's error allows" 0 "$(run taskfailed)"
touch "$RUN_GOAL_STATE_DIR/taskdated.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: task retro-run-goal-20261106\n' >"$RUN_GOAL_STATE_DIR/taskdated.retro.md"
expect "a bare task id with a date still blocks" 2 "$(run taskdated)"
touch "$RUN_GOAL_STATE_DIR/taskhash.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: task #12\n' >"$RUN_GOAL_STATE_DIR/taskhash.retro.md"
expect "a bare task number still blocks" 2 "$(run taskhash)"
touch "$RUN_GOAL_STATE_DIR/taskdidnot.contract.md"
printf -- '- write-changelog: fixed, commit 4a0ac04\n- run-goal: task retro-x, Write failed: sandbox did not allow the write\n' >"$RUN_GOAL_STATE_DIR/taskdidnot.retro.md"
expect "an error text with 'did not' still allows" 0 "$(run taskdidnot)"
msg=$(jq -cn --arg s taskdated --arg p "$TX" '{hook_event_name:"Stop",session_id:$s,transcript_path:$p}' | bash "$SCRIPT" 2>&1 >/dev/null)
case "$msg" in *"task <id>, write failed: <error>"*) ok=0 ;; *) ok=1 ;; esac
expect "the block message shows the task form" 0 "$ok"
# Work goes on and uses a new skill: the gate must still see it.
jq -cn '{type:"assistant",message:{content:[{type:"tool_use",name:"Skill",input:{skill:"code-review"}}]}}' >>"$TX"
expect "a skill used after the retro blocks again" 2 "$(run s1)"
printf -- '- code-review: Step 6a test, PR #171\n' >>"$RUN_GOAL_STATE_DIR/s1.retro.md"
expect "listing the new skill allows again" 0 "$(run s1)"

touch "$RUN_GOAL_STATE_DIR/s2.contract.md"
printf -- '- run-goal: task run-goal-eval-123, write failed: read-only file system\n' >"$RUN_GOAL_STATE_DIR/s2.retro.md"
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

# Clock goals have a numeric deadline in the session contract. The draft
# marker alone must never waive the final retro after that deadline.
clock_now="$(date +%s)"
printf 'Clock wrap-up epoch: %s\n' "$((clock_now + 3600))" >"$RUN_GOAL_STATE_DIR/clock.contract.md"
printf 'Goal result: in progress (clock goal, wrap-up at 17:00)\n' >"$RUN_GOAL_STATE_DIR/clock.retro.md"
expect "future clock goal draft allows" 0 "$(run clock)"
expect "future clock wait does not count as block" 0 "$(has clock.stopblocks)"
printf 'Clock wrap-up epoch: %s\n' "$((clock_now - 1))" >"$RUN_GOAL_STATE_DIR/clock.contract.md"
expect "expired clock goal requires final retro" 2 "$(run clock)"
printf 'Clock wrap-up epoch: malformed\n' >"$RUN_GOAL_STATE_DIR/badclock.contract.md"
cp "$RUN_GOAL_STATE_DIR/clock.retro.md" "$RUN_GOAL_STATE_DIR/badclock.retro.md"
expect "malformed clock deadline requires final retro" 2 "$(run badclock)"
touch "$RUN_GOAL_STATE_DIR/noclock.contract.md"
cp "$RUN_GOAL_STATE_DIR/clock.retro.md" "$RUN_GOAL_STATE_DIR/noclock.retro.md"
expect "draft marker without deadline requires final retro" 2 "$(run noclock)"
printf 'Clock wrap-up epoch: %s\n' "$((clock_now + 3600))" >"$RUN_GOAL_STATE_DIR/nodraft.contract.md"
expect "deadline without draft still requires retro" 2 "$(run nodraft)"

touch "$RUN_GOAL_STATE_DIR/s3.contract.md"
expect "bypass allows" 0 "$(run s3 HOOK_BYPASS_GOAL_RETRO_BEFORE_STOP=1)"
expect "unsafe session id allows" 0 "$(run '../x')"

echo "goal-retro-before-stop.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
