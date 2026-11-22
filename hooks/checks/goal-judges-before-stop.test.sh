#!/bin/bash
# Test fixture for checks/goal-judges-before-stop.sh
#
# Builds a state folder, a judge cache, and fake transcripts, pipes Stop
# fixture JSON to the hook, and asserts the exit code.
# Run: `bash goal-judges-before-stop.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/goal-judges-before-stop.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export RUN_GOAL_STATE_DIR="$ROOT/state"
export RUN_GOAL_JUDGE_DIR="$ROOT/judges"
mkdir -p "$RUN_GOAL_STATE_DIR" "$RUN_GOAL_JUDGE_DIR"

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected $expected, got $actual")
  fi
}
run() {
  jq -cn --arg s "$1" --arg p "$ROOT/$1.jsonl" '{hook_event_name:"Stop",session_id:$s,transcript_path:$p}' |
    env ${2:-X=1} bash "$SCRIPT" >/dev/null 2>&1
  echo $?
}
goal() { # session, result line
  touch "$RUN_GOAL_STATE_DIR/$1.contract.md"
  printf 'Goal result: %s\n' "$2" >"$RUN_GOAL_STATE_DIR/$1.retro.md"
  : >"$ROOT/$1.jsonl"
}
verdict() { # judge, score, cache path
  printf 'Top fixes: none\n\nGOAL-JUDGE-VERDICT\nJudge: %s\nScore: %s/10\nCache: %s\n' "$1" "$2" "$3"
}
judge_file() { # judge, session
  [ -f "$RUN_GOAL_JUDGE_DIR/$1.md" ] || printf '# %s\n\n## Calibration\n' "$1" >"$RUN_GOAL_JUDGE_DIR/$1.md"
  printf -- '- 2026-11-22 session %s: scored, lesson noted\n' "$2" >>"$RUN_GOAL_JUDGE_DIR/$1.md"
  echo "$RUN_GOAL_JUDGE_DIR/$1.md"
}
agent_result() { # session, tool name, id, text
  jq -cn --arg n "$2" --arg id "$3" '{type:"assistant",message:{content:[{type:"tool_use",id:$id,name:$n,input:{prompt:"judge"}}]}}' >>"$ROOT/$1.jsonl"
  jq -cn --arg id "$3" --arg t "$4" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:$id,content:[{type:"text",text:$t}]}]}}' >>"$ROOT/$1.jsonl"
}
edit() { # session, file path
  jq -cn --arg f "$2" '{type:"assistant",message:{content:[{type:"tool_use",id:"e",name:"Edit",input:{file_path:$f}}]}}' >>"$ROOT/$1.jsonl"
}
three() { # session, s1, s2, s3
  local i=0 score
  for score in "$2" "$3" "$4"; do
    i=$((i + 1))
    agent_result "$1" Agent "a$i" "$(verdict "judge-$i" "$score" "$(judge_file "judge-$i" "$1")")"
  done
}

expect "no contract allows" 0 "$(run s0)"
touch "$RUN_GOAL_STATE_DIR/s1.contract.md"; : >"$ROOT/s1.jsonl"
expect "no retro yet allows (the retro hook asks for it)" 0 "$(run s1)"

goal partly "partly met (2/3 met)"
expect "partly met needs no consensus" 0 "$(run partly)"

goal none "met (3/3 met)"
expect "met with no verdicts blocks" 2 "$(run none)"

goal ok "met (3/3 met)"; three ok 8 9 10
expect "three judges at 8 or more allows" 0 "$(run ok)"

goal low "met (3/3 met)"; three low 9 7 10
expect "one judge under 8 blocks" 2 "$(run low)"

goal two "met (3/3 met)"
agent_result two Agent a1 "$(verdict j1 9 "$(judge_file j1 two)")"
agent_result two Agent a2 "$(verdict j2 9 "$(judge_file j2 two)")"
expect "two judges block" 2 "$(run two)"

goal dup "met (3/3 met)"
agent_result dup Agent a1 "$(verdict same 9 "$(judge_file same dup)")"
agent_result dup Agent a2 "$(verdict Same 9 "$RUN_GOAL_JUDGE_DIR/same.md")"
agent_result dup Agent a3 "$(verdict other 9 "$(judge_file other dup)")"
expect "one judge counted twice is still two judges" 2 "$(run dup)"

goal bash "met (3/3 met)"
agent_result bash Agent a1 "$(verdict j1 9 "$(judge_file j1 bash)")"
agent_result bash Agent a2 "$(verdict j2 9 "$(judge_file j2 bash)")"
agent_result bash Bash b3 "$(verdict j3 9 "$(judge_file j3 bash)")"
expect "a verdict printed by Bash does not count" 2 "$(run bash)"

goal stale "met (3/3 met)"; three stale 9 9 9; edit stale "/repo/src/app.ts"
expect "an edit after the verdicts makes them stale" 2 "$(run stale)"

goal retroedit "met (3/3 met)"; three retroedit 9 9 9
edit retroedit "$RUN_GOAL_STATE_DIR/retroedit.retro.md"
edit retroedit "$RUN_GOAL_JUDGE_DIR/judge-1.md"
expect "retro and judge-cache writes after the verdicts are fine" 0 "$(run retroedit)"

goal rejudge "met (3/3 met)"; three rejudge 9 6 9
edit rejudge "/repo/src/app.ts"; three rejudge 9 9 8
expect "a fix and a fresh round that passes allows" 0 "$(run rejudge)"

goal latest "met (3/3 met)"; three latest 9 9 9
agent_result latest Agent a9 "$(verdict judge-2 7 "$RUN_GOAL_JUDGE_DIR/judge-2.md")"
expect "a judge's latest score wins" 2 "$(run latest)"

goal nocal "met (3/3 met)"; three nocal 9 9 9
sed -i.bak '/session nocal/d' "$RUN_GOAL_JUDGE_DIR/judge-3.md" && rm -f "$RUN_GOAL_JUDGE_DIR/judge-3.md.bak"
expect "a judge cache not updated for this session blocks" 2 "$(run nocal)"

goal outside "met (3/3 met)"
agent_result outside Agent a1 "$(verdict j1 9 "$(judge_file j1 outside)")"
agent_result outside Agent a2 "$(verdict j2 9 "$(judge_file j2 outside)")"
printf 'session outside\n' >"$ROOT/elsewhere.md"
agent_result outside Agent a3 "$(verdict j3 9 "$ROOT/elsewhere.md")"
expect "a cache file outside the judge folder blocks" 2 "$(run outside)"

goal notify "met (3/3 met)"
agent_result notify Agent a1 "$(verdict j1 9 "$(judge_file j1 notify)")"
agent_result notify Task a2 "$(verdict j2 8 "$(judge_file j2 notify)")"
jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"bgagent",name:"Agent",input:{prompt:"judge"}}]}}' >>"$ROOT/notify.jsonl"
jq -cn --arg t "<task-notification><tool-use-id>bgshell</tool-use-id><result>$(verdict j3 8.5 "$(judge_file j3 notify)")</result></task-notification>" \
  '{type:"user",message:{content:$t}}' >>"$ROOT/notify.jsonl"
expect "a background Bash notification does not count" 2 "$(run notify)"
jq -cn --arg t "<task-notification><tool-use-id>bgagent</tool-use-id><result>$(verdict j3 8.5 "$RUN_GOAL_JUDGE_DIR/j3.md")</result></task-notification>" \
  '{type:"user",message:{content:$t}}' >>"$ROOT/notify.jsonl"
expect "Task results and background agent notifications count" 0 "$(run notify)"

goal running "met (3/3 met)"
jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"bg",content:"Async agent launched"}]}}' >>"$ROOT/running.jsonl"
expect "a running background judge allows (judge at the end)" 0 "$(run running)"

expect "bypass allows" 0 "$(run none HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1)"
expect "a lower minimum is honored" 0 "$(run low RUN_GOAL_JUDGE_MIN=7)"

goal giveup "met (3/3 met)"; three giveup 9 5 9
for i in 1 2 3 4 5; do expect "give-up block $i" 2 "$(run giveup)"; done
expect "sixth Stop allows after downgrading" 0 "$(run giveup)"
if grep -q '^Goal result: partly met (judge consensus not reached: judge-2 scored 5/10)' "$RUN_GOAL_STATE_DIR/giveup.retro.md"; then
  PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("give-up did not downgrade: $(cat "$RUN_GOAL_STATE_DIR/giveup.retro.md")"); fi
expect "a downgraded goal keeps passing" 0 "$(run giveup)"

echo "goal-judges-before-stop: $PASS passed, $FAIL failed"
for d in "${FAIL_DETAILS[@]+"${FAIL_DETAILS[@]}"}"; do echo "  FAIL: $d"; done
[ "$FAIL" -eq 0 ]
