#!/bin/bash
# agentbrew/hooks/checks/goal-judges-before-stop.sh
#
# **Hook**: goal-judges-before-stop
# **Event**: Stop
# **Verdict**: block (after five blocks it downgrades the claim and allows)
# **Source rule**: skill-plugins/workflow/run-goal/references/goal-judges.md
#   (owner request 2026-11-22: a goal succeeds only when three of the best
#   judges in its field agree it scores 8/10 or more)
#
# A goal may end as "met" only with a judge consensus. While the session's
# retro file says `Goal result: met`, this hook blocks Stop until the
# transcript holds a verdict from at least three different judges, each
# judge's latest score is at least the minimum (default 8 of 10), and every
# verdict came after the last file edit (it judged the final state).
#
# **Verdicts**: a block in a subagent's result:
#
#     GOAL-JUDGE-VERDICT
#     Judge: <judge id>
#     Score: <0-10>/10
#     Cache: <path of the judge's cache file>
#
# Only results of `Agent` or `Task` tool calls and background-task
# notifications count. The agent's own text and Bash output never count, so
# an `echo` of the block does not pass.
#
# **Judge cache**: judges are cached files, one per judge, in
# `RUN_GOAL_JUDGE_DIR` (default `~/.config/agentbrew/goal-judges`). The
# runner improves each judge after every use. So each verdict's `Cache:` file
# must exist in that folder and must name this session id (the runner's
# calibration line for this use).
#
# **Freshness**: an Edit, Write, MultiEdit, or NotebookEdit after a verdict
# makes it stale, except writes to the run-goal state folder or the judge
# cache (the retro and the calibration notes).
#
# **Scope**: acts only while `<session_id>.contract.md` exists and the retro
# says `Goal result: met`. Partly met, blocked, or in-progress goals pass.
# It also allows while a background task is still running.
#
# **Give-up**: after five blocks, it rewrites the retro's result line to
# `Goal result: partly met (judge consensus not reached: <reason>)` and
# allows. So the goal never reads as met without the consensus.
#
# **Bypass**: `HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.
#   - RUN_GOAL_JUDGE_DIR: judge cache. Default `$HOME/.config/agentbrew/goal-judges`.
#   - RUN_GOAL_JUDGE_MIN: lowest passing score. Default 8.
#   - RUN_GOAL_JUDGE_COUNT: judges needed. Default 3.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-judges-before-stop"
readonly MAX_BLOCKS=5

if [ "${HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1"
fi

INPUT="$(read_hook_stdin)"
SESSION_ID="$(json_get "$INPUT" '.session_id')"
case "$SESSION_ID" in
  "" | *[!A-Za-z0-9_-]*) verdict_allow "$HOOK_ID" "no usable session id" ;;
esac

STATE_DIR="${RUN_GOAL_STATE_DIR:-$HOME/.cache/agentbrew/run-goal}"
JUDGE_DIR="${RUN_GOAL_JUDGE_DIR:-$HOME/.config/agentbrew/goal-judges}"
MIN="${RUN_GOAL_JUDGE_MIN:-8}"
NEED="${RUN_GOAL_JUDGE_COUNT:-3}"
case "$MIN" in "" | *[!0-9.]*) MIN=8 ;; esac
case "$NEED" in "" | *[!0-9]*) NEED=3 ;; esac
CONTRACT="$STATE_DIR/$SESSION_ID.contract.md"
RETRO="$STATE_DIR/$SESSION_ID.retro.md"
COUNTER="$STATE_DIR/$SESSION_ID.judgeblocks"

[ -f "$CONTRACT" ] || verdict_allow "$HOOK_ID" "no active goal contract"
[ -f "$RETRO" ] || verdict_allow "$HOOK_ID" "no retro yet"
grep -qE '^Goal result: met([^A-Za-z]|$)' "$RETRO" ||
  verdict_allow "$HOOK_ID" "goal does not claim met"

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
VERDICTS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  RUNNING="$(hook_jq -r -s '
    def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
      elif type == "object" then ((.text // .content // "") | texts) else "" end;
    [ .[] | select(.type == "user") | .message.content ] as $c
    | ([ $c[] | arrays | .[] | select(.type? == "tool_result")
         | select((.content | texts) | test("Async agent launched|running in background with ID"))
         | .tool_use_id ]) as $launched
    | ([ $c[] | texts | scan("<tool-use-id>([^<]+)</tool-use-id>") | .[0] ]) as $done
    | ($launched - $done) | length' "$TRANSCRIPT" 2>/dev/null || echo 0)"
  case "$RUNNING" in "" | *[!0-9]*) RUNNING=0 ;; esac
  if [ "$RUNNING" -gt 0 ]; then
    verdict_allow "$HOOK_ID" "goal still waiting on $RUNNING background task(s); judges run at the end"
  fi

  # One TSV row per judge: id, latest fresh score, cache path.
  VERDICTS="$(hook_jq -r -s --arg state "$STATE_DIR/" --arg judges "$JUDGE_DIR/" \
    -f "$__HOOK_LIB_DIR/goal-judge-verdicts.jq" "$TRANSCRIPT" 2>/dev/null || true)"
fi

PROBLEMS=""
COUNT=0
LOWEST=""
while IFS=$'\t' read -r key s c; do
  [ -n "${key:-}" ] || continue
  COUNT=$((COUNT + 1))
  c="${c/#\~/$HOME}"
  if [ -z "$LOWEST" ] || awk -v a="$s" -v b="$LOWEST" 'BEGIN{exit !(a<b)}'; then LOWEST="$s"; fi
  if awk -v a="$s" -v m="$MIN" 'BEGIN{exit !(a<m)}'; then
    PROBLEMS="$PROBLEMS; $key scored $s/10"
  fi
  case "$c" in
    "$JUDGE_DIR"/*) ;;
    *) PROBLEMS="$PROBLEMS; $key cache $c is not in $JUDGE_DIR"; continue ;;
  esac
  if [ ! -f "$c" ]; then
    PROBLEMS="$PROBLEMS; $key cache file is missing"
  elif ! grep -qF -- "$SESSION_ID" "$c"; then
    PROBLEMS="$PROBLEMS; $key cache file has no calibration line for session $SESSION_ID"
  fi
done <<EOF_VERDICTS
$VERDICTS
EOF_VERDICTS
if [ "$COUNT" -lt "$NEED" ]; then
  PROBLEMS="$PROBLEMS; $COUNT of $NEED fresh judge verdicts"
fi
PROBLEMS="${PROBLEMS#; }"

if [ -z "$PROBLEMS" ]; then
  rm -f "$COUNTER"
  verdict_allow "$HOOK_ID" "judge consensus: $COUNT judges, lowest $LOWEST/10"
fi

blocks=0
[ -f "$COUNTER" ] && blocks="$(cat "$COUNTER" 2>/dev/null || echo 0)"
case "$blocks" in "" | *[!0-9]*) blocks=0 ;; esac
if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  reason="$(tr -d '\n' <<<"$PROBLEMS" | sed 's/[&|]/ /g')"
  sed -i.bak -E "s|^Goal result: met([^A-Za-z].*)?$|Goal result: partly met (judge consensus not reached: $reason)|" "$RETRO" && rm -f "$RETRO.bak"
  verdict_allow "$HOOK_ID" "gave up after $MAX_BLOCKS blocks; retro downgraded to partly met: $PROBLEMS"
fi
echo $((blocks + 1)) >"$COUNTER"

verdict_block "$HOOK_ID" "The goal says met, but it has no judge consensus yet ($PROBLEMS). Follow run-goal references/goal-judges.md: run $NEED fresh-context judge subagents (the best judges for this goal's field, cached in $JUDGE_DIR) on the final state. Each returns the GOAL-JUDGE-VERDICT block (Judge, Score N/10, Cache). Every judge needs $MIN/10 or more. Then add a calibration line with session $SESSION_ID to each judge's cache file. If you cannot reach $MIN/10, apply the judges' top fixes and judge again, or change the retro to Goal result: partly met. Never edit files after the verdicts, or judge again."
