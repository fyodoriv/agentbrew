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
# retro says `Goal result: met`, this hook blocks Stop until each judge the
# contract names has exactly one verdict for the current state, each scored
# at least the minimum (default 8 of 10).
#
# **Contract**: `Judges: <id>, <id>, <id>` and `Judged paths: <path>, ...`.
# Both are frozen: they are part of the state token.
#
# **State token**: `lib/goal-state.sh <contract>` hashes the contract, each
# judge's rubric (its file up to `## Calibration`), and the judged paths (git
# HEAD, status, diff, untracked files). Any edit by any tool changes it. A
# verdict counts only when its `State:` equals the token now.
#
# **Verdicts**: one block per judge subagent result:
#
#     GOAL-JUDGE-VERDICT
#     Judge: <judge id>
#     Score: <0-10>/10
#     Cache: <judge dir>/<judge id>.md
#     State: <token>
#
# Only results of `Agent` or `Task` calls and their background notifications
# count; the agent's own text and Bash output never do. A result with two or
# more blocks counts for none. The call's prompt must name the cache file and
# hold no pre-filled score. Two verdicts from one judge for one state is a
# re-roll and fails. The judges must use at least `RUN_GOAL_JUDGE_MODELS`
# different models (Agent `model`; none given counts as "inherit").
#
# **Judge cache**: `RUN_GOAL_JUDGE_DIR` (default
# `~/.config/agentbrew/goal-judges`), one `<id>.md` per judge. The runner
# improves each judge after use: its `## Calibration` section must name this
# session id.
#
# **Background tasks**: while a task is still running, the hook allows (the
# judges may be the ones running), at most 10 times per goal.
#
# **Give-up**: after five blocks it rewrites the retro's result line to
# `Goal result: partly met (judge consensus not reached: <reason>)` and
# allows, so a goal never reads as met without the consensus.
#
# **Bypass**: `HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.
#   - RUN_GOAL_JUDGE_DIR: judge cache. Default `$HOME/.config/agentbrew/goal-judges`.
#   - RUN_GOAL_JUDGE_MIN: lowest passing score. Default 8.
#   - RUN_GOAL_JUDGE_COUNT: judges needed. Default 3.
#   - RUN_GOAL_JUDGE_MODELS: different judge models needed. Default 2.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-judges-before-stop"
readonly MAX_BLOCKS=5
readonly MAX_WAITS=10
readonly MET_RE='^[-*_ ]*goal result:[*_ ]*met([^a-z]|$)'

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
MODELS="${RUN_GOAL_JUDGE_MODELS:-2}"
case "$MIN" in "" | *[!0-9.]*) MIN=8 ;; esac
case "$NEED" in "" | *[!0-9]*) NEED=3 ;; esac
case "$MODELS" in "" | *[!0-9]*) MODELS=2 ;; esac
CONTRACT="$STATE_DIR/$SESSION_ID.contract.md"
RETRO="$STATE_DIR/$SESSION_ID.retro.md"
COUNTER="$STATE_DIR/$SESSION_ID.judgeblocks"
WAITS="$STATE_DIR/$SESSION_ID.judgewaits"
STATE_CMD="bash $__HOOK_LIB_DIR/goal-state.sh $CONTRACT"

[ -f "$CONTRACT" ] || verdict_allow "$HOOK_ID" "no active goal contract"
[ -f "$RETRO" ] || verdict_allow "$HOOK_ID" "no retro yet"
RETRO_LOWER="$(tr '[:upper:]' '[:lower:]' <"$RETRO")"
grep -qE "$MET_RE" <<<"$RETRO_LOWER" ||
  verdict_allow "$HOOK_ID" "goal does not claim met"

count() { local n=0; [ -f "$1" ] && n="$(cat "$1" 2>/dev/null || echo 0)"; case "$n" in "" | *[!0-9]*) n=0 ;; esac; echo "$n"; }

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
ROWS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  ROWS="$(hook_jq -R -r -n -f "$__HOOK_LIB_DIR/goal-judge-verdicts.jq" <"$TRANSCRIPT" 2>/dev/null || true)"
fi
RUNNING="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="R"{print $2; exit}')"
case "$RUNNING" in "" | *[!0-9]*) RUNNING=0 ;; esac
if [ "$RUNNING" -gt 0 ]; then
  waits="$(count "$WAITS")"
  if [ "$waits" -lt "$MAX_WAITS" ]; then
    echo $((waits + 1)) >"$WAITS"
    verdict_allow "$HOOK_ID" "goal still waiting on $RUNNING background task(s); judges run at the end"
  fi
fi

PROBLEMS=""
add() { PROBLEMS="$PROBLEMS; $1"; }

JUDGES="$(sed -nE 's/^[-*_ ]*Judges:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | tr '[:upper:]' '[:lower:]' | LC_ALL=C sort -u)"
NJ="$(printf '%s\n' "$JUDGES" | sed '/^$/d' | wc -l | tr -d ' ')"
TOKEN=""
if [ "$NJ" -lt "$NEED" ]; then
  add "the contract names $NJ of $NEED judges (add a 'Judges: <id>, <id>, <id>' line before judging)"
elif ! TOKEN="$(RUN_GOAL_JUDGE_DIR="$JUDGE_DIR" bash "$__HOOK_LIB_DIR/goal-state.sh" "$CONTRACT" 2>&1)"; then
  add "${TOKEN#goal-state: }"
  TOKEN=""
fi

# One row per tool_use id (a notification can appear in two row types).
VROWS="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="V" && !seen[$2]++')"
MROWS="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="M"' | wc -l | tr -d ' ')"
[ "$MROWS" -gt 0 ] && add "$MROWS result(s) held more than one verdict block and count for none"

USED_MODELS=""
LOWEST=""
if [ -n "$TOKEN" ]; then
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    cache="$JUDGE_DIR/$id.md"
    mine="$(printf '%s\n' "$VROWS" | awk -F'\t' -v j="$id" -v t="$TOKEN" '$3==j && $6==t')"
    n="$(printf '%s\n' "$mine" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [ "$n" -eq 0 ]; then
      add "$id has no verdict for the current state $TOKEN"; continue
    elif [ "$n" -gt 1 ]; then
      add "$id was judged $n times on one state (a re-roll); change the work, then judge all again"; continue
    fi
    IFS=$'\t' read -r _ _ _ score vcache _ model ok <<<"$mine"
    [ "${vcache/#\~/$HOME}" = "$cache" ] || add "$id cites cache $vcache, not $cache"
    [ "$ok" = 1 ] || add "$id's prompt does not name $cache or holds a pre-filled score"
    if awk -v a="$score" 'BEGIN{exit !(a>10)}'; then add "$id score $score is out of range"; continue; fi
    awk -v a="$score" -v m="$MIN" 'BEGIN{exit !(a<m)}' && add "$id scored $score/10"
    if [ -z "$LOWEST" ] || awk -v a="$score" -v b="$LOWEST" 'BEGIN{exit !(a<b)}'; then LOWEST="$score"; fi
    case " $USED_MODELS " in *" $model "*) ;; *) USED_MODELS="$USED_MODELS $model" ;; esac
    awk -v s="$SESSION_ID" '/^## Calibration/{c=1} c && index($0, s){f=1} END{exit !f}' "$cache" 2>/dev/null ||
      add "$id's ## Calibration section has no line for session $SESSION_ID"
  done <<<"$JUDGES"
  NM="$(printf '%s\n' $USED_MODELS | sed '/^$/d' | wc -l | tr -d ' ')"
  [ -n "$LOWEST" ] && [ "$NM" -lt "$MODELS" ] &&
    add "judges used $NM model(s) ($USED_MODELS ); use at least $MODELS (set the Agent model for one judge)"
fi
PROBLEMS="${PROBLEMS#; }"

if [ -z "$PROBLEMS" ]; then
  rm -f "$COUNTER" "$WAITS"
  verdict_allow "$HOOK_ID" "judge consensus: $NJ judges, lowest $LOWEST/10, state $TOKEN"
fi

blocks="$(count "$COUNTER")"
if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  reason="$(printf '%s' "$PROBLEMS" | tr -d '\n' | cut -c1-300)"
  tmp="$RETRO.tmp.$$"
  awk -v re="$MET_RE" -v r="$reason" '{ if (tolower($0) ~ re) print "Goal result: partly met (judge consensus not reached: " r ")"; else print }' "$RETRO" >"$tmp" &&
    mv "$tmp" "$RETRO"
  verdict_allow "$HOOK_ID" "gave up after $MAX_BLOCKS blocks; retro downgraded to partly met: $PROBLEMS"
fi
echo $((blocks + 1)) >"$COUNTER"

verdict_block "$HOOK_ID" "The goal says met, but it has no judge consensus yet: $PROBLEMS. Follow run-goal references/goal-judges.md as the last step, after the retro and the report: get the state token with \`$STATE_CMD\`, run each contract judge once as a fresh-context subagent (at least $MODELS different models) with its judge file path and that token, and add a calibration line for session $SESSION_ID to each judge's ## Calibration section. Every judge needs $MIN/10 or more. If you cannot reach it, apply the top fixes and judge all again, or change the retro to Goal result: partly met."
