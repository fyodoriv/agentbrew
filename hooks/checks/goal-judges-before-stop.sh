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
# retro claims met, this hook blocks Stop until each judge the contract names
# has exactly one verdict for the current state, each scored at least the
# minimum (default 8 of 10).
#
# **Claim**: a retro line that starts with `Goal result` (after list,
# heading, quote, bold, or number marks) and does not say partly met, not
# met, in progress, or blocked. Unknown forms count as claims.
#
# **Contract**: `Judges: <id>, <id>, <id>` and `Judged paths: <path>, ...`.
#
# **State token**: `lib/goal-state.sh <contract>` hashes the contract, each
# judge's rubric (its file up to `## Calibration`), and the judged paths (git
# HEAD, status, diff, untracked files). Any edit by any tool changes it. A
# verdict counts only when its `State:` equals the token now. goal-state.sh
# also refuses a judge file below the rubric floor.
#
# **Prompt**: each judge call's prompt must equal the output of
# `lib/goal-judge-prompt.sh <contract> <id>` (outer whitespace aside), so the
# runner cannot add steering text, and must not be a `fork`.
#
# **Verdicts**: one block per judge subagent result (bold names allowed):
#
#     GOAL-JUDGE-VERDICT
#     Judge: <judge id>
#     Score: <0-10>/10
#     Cache: <judge dir>/<judge id>.md
#     State: <token>
#
# Only results of `Agent` or `Task` calls and their background notifications
# after the last `/goal <condition>` command count. A result with two or more
# blocks counts for none. Two verdicts from one judge for one state is a
# re-roll and fails. Judges must use at least `RUN_GOAL_JUDGE_MODELS` model
# families (a call with no `model` counts as the runner's own).
#
# **Rounds**: the judge prompts in the transcript freeze the judge set and
# each rubric hash at the goal's first round; a goal gets
# `RUN_GOAL_JUDGE_ROUNDS` distinct judged states.
#
# **Judge cache**: `RUN_GOAL_JUDGE_DIR` (default
# `~/.config/agentbrew/goal-judges`), one `<id>.md` per judge. Its
# `## Calibration` section needs a line with this session id, the token, and
# the score as `N/10`.
#
# **Background judges**: while a judge call is still running, the hook
# allows, at most 10 times per goal. Other background tasks do not excuse.
#
# **Give-up**: after five blocks it rewrites each claim line to
# `Goal result: partly met (judge consensus not reached: <reason>)`, resets
# its counters, and allows, so a goal never reads as met without consensus.
#
# **Bypass**: `HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1`
#
# **Configuration** (optional):
#   - RUN_GOAL_STATE_DIR: state folder. Default `$HOME/.cache/agentbrew/run-goal`.
#   - RUN_GOAL_JUDGE_DIR: judge cache. Default `$HOME/.config/agentbrew/goal-judges`.
#   - RUN_GOAL_JUDGE_MIN: lowest passing score. Default 8.
#   - RUN_GOAL_JUDGE_COUNT: judges needed. Default 3.
#   - RUN_GOAL_JUDGE_MODELS: different judge model families needed. Default 2.
#   - RUN_GOAL_JUDGE_ROUNDS: judging rounds allowed per goal. Default 3.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="goal-judges-before-stop"
# Five, not three like goal-retro-before-stop: each judging round needs the
# judges to run between two Stops.
readonly MAX_BLOCKS=5
readonly MAX_WAITS=10
# A retro line claims met when it starts with "Goal result" (after list,
# heading, quote, bold, and number marks) and its value is not a known
# not-met form. Unknown forms ("met", "fully met", "done") are claims.
readonly CLAIM_AWK='function claim(l,  r) { l = tolower(l); gsub(/[*_`]/, "", l); sub(/^[[:space:]#>0-9.)-]*/, "", l)
  if (l !~ /^goal result([^a-z]|$)/) return 0
  r = substr(l, 12); sub(/^[^a-z]*/, "", r)
  return r !~ /^(partly|partially|not|un|in progress|blocked|impossible|pending)/ }'

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
ROUNDS="${RUN_GOAL_JUDGE_ROUNDS:-3}"
case "$MIN" in "" | *[!0-9.]*) MIN=8 ;; esac
case "$NEED" in "" | *[!0-9]*) NEED=3 ;; esac
case "$MODELS" in "" | *[!0-9]*) MODELS=2 ;; esac
case "$ROUNDS" in "" | *[!0-9]*) ROUNDS=3 ;; esac
CONTRACT="$STATE_DIR/$SESSION_ID.contract.md"
RETRO="$STATE_DIR/$SESSION_ID.retro.md"
COUNTER="$STATE_DIR/$SESSION_ID.judgeblocks"
WAITS="$STATE_DIR/$SESSION_ID.judgewaits"
PROMPT_CMD="bash $__HOOK_LIB_DIR/goal-judge-prompt.sh $CONTRACT <judge id>"

[ -f "$CONTRACT" ] || verdict_allow "$HOOK_ID" "no active goal contract"
[ -f "$RETRO" ] || verdict_allow "$HOOK_ID" "no retro yet"
awk "$CLAIM_AWK"' claim($0) { f = 1 } END { exit !f }' "$RETRO" ||
  verdict_allow "$HOOK_ID" "goal does not claim met"

count() { local n=0; [ -f "$1" ] && n="$(cat "$1" 2>/dev/null || echo 0)"; case "$n" in "" | *[!0-9]*) n=0 ;; esac; echo "$n"; }

PROBLEMS=""
add() { PROBLEMS="$PROBLEMS; $1"; }

JUDGES="$(sed -nE 's/^[-*_ ]*Judges:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | tr '[:upper:]' '[:lower:]' | LC_ALL=C sort -u)"
NJ="$(printf '%s\n' "$JUDGES" | sed '/^$/d' | wc -l | tr -d ' ')"
TOKEN=""
CANON="{}"
if [ "$NJ" -lt "$NEED" ]; then
  add "the contract names $NJ of $NEED judges (add a 'Judges: <id>, <id>, <id>' line before judging)"
elif ! TOKEN="$(RUN_GOAL_JUDGE_DIR="$JUDGE_DIR" bash "$__HOOK_LIB_DIR/goal-state.sh" "$CONTRACT" 2>&1)"; then
  add "${TOKEN#goal-state: }"
  TOKEN=""
else
  while IFS= read -r id; do
    p="$(GOAL_STATE_TOKEN="$TOKEN" bash "$__HOOK_LIB_DIR/goal-judge-prompt.sh" "$CONTRACT" "$id" "$JUDGE_DIR" 2>/dev/null)" || continue
    CANON="$(hook_jq -c --arg k "$id" --arg v "$p" '. + {($k): $v}' <<<"$CANON")"
  done <<<"$JUDGES"
fi

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
ROWS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  ROWS="$(hook_jq -R -r -n --argjson canon "$CANON" -f "$__HOOK_LIB_DIR/goal-judge-verdicts.jq" <"$TRANSCRIPT" 2>/dev/null || true)"
fi
RUNNING="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="R"{print $2; exit}')"
case "$RUNNING" in "" | *[!0-9]*) RUNNING=0 ;; esac
if [ "$RUNNING" -gt 0 ]; then
  waits="$(count "$WAITS")"
  if [ "$waits" -lt "$MAX_WAITS" ]; then
    echo $((waits + 1)) >"$WAITS"
    verdict_allow "$HOOK_ID" "goal still waiting on $RUNNING judge(s) running in the background"
  fi
fi

# Rounds, frozen judge set, and frozen rubrics, from this goal's judge prompts.
PROWS="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="P"')"
if [ -n "$PROWS" ]; then
  NR_ROUNDS="$(printf '%s\n' "$PROWS" | awk -F'\t' '!seen[$5]++' | wc -l | tr -d ' ')"
  [ "$NR_ROUNDS" -gt "$ROUNDS" ] &&
    add "this goal used $NR_ROUNDS judging rounds; the cap is $ROUNDS (more rounds farm for a lucky score)"
  FIRST_STATE="$(printf '%s\n' "$PROWS" | awk -F'\t' 'NR==1{print $5}')"
  FIRST_SET="$(printf '%s\n' "$PROWS" | awk -F'\t' -v s="$FIRST_STATE" '$5==s{print $3}' | LC_ALL=C sort -u)"
  [ "$FIRST_SET" = "$JUDGES" ] ||
    add "the judge set changed after the first round (first: $(printf '%s ' $FIRST_SET)now: $(printf '%s ' $JUDGES)); keep the first panel"
  while IFS= read -r id; do
    [ -n "$id" ] && [ -f "$JUDGE_DIR/$id.md" ] || continue
    first="$(printf '%s\n' "$PROWS" | awk -F'\t' -v j="$id" '$3==j{print $4; exit}')"
    now="$(bash "$__HOOK_LIB_DIR/goal-state.sh" --rubric-sha "$JUDGE_DIR/$id.md" 2>/dev/null || true)"
    [ -z "$first" ] || [ "$first" = "$now" ] ||
      add "$id's rubric changed after its first round; put rubric changes in ## Calibration and merge them at the next goal"
  done <<<"$JUDGES"
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
    IFS=$'\t' read -r _ _ _ score vcache _ model ok fork <<<"$mine"
    [ "${vcache/#\~/$HOME}" = "$cache" ] || add "$id cites cache $vcache, not $cache"
    [ "$ok" = 1 ] || add "$id's prompt is not the exact output of goal-judge-prompt.sh for this state"
    [ "$fork" = 1 ] && add "$id ran as a fork (it shares the runner's context); use a fresh subagent"
    case "$score" in bad | "") add "$id's Score line is not N/10"; continue ;; esac
    if awk -v a="$score" 'BEGIN{exit !(a>10)}'; then add "$id score $score is out of range"; continue; fi
    awk -v a="$score" -v m="$MIN" 'BEGIN{exit !(a<m)}' && add "$id scored $score/10"
    if [ -z "$LOWEST" ] || awk -v a="$score" -v b="$LOWEST" 'BEGIN{exit !(a<b)}'; then LOWEST="$score"; fi
    case " $USED_MODELS " in *" $model "*) ;; *) USED_MODELS="$USED_MODELS $model" ;; esac
    awk -v s="$SESSION_ID" -v t="$TOKEN" -v sc="$score/10" \
      '/^## Calibration/{c=1} c && index($0, s) && index($0, t) && index($0, sc){f=1} END{exit !f}' "$cache" 2>/dev/null ||
      add "$id's ## Calibration section has no line with session $SESSION_ID, state $TOKEN, and $score/10"
  done <<<"$JUDGES"
  NM="$(printf '%s\n' $USED_MODELS | sed '/^$/d' | wc -l | tr -d ' ')"
  [ -n "$LOWEST" ] && [ "$NM" -lt "$MODELS" ] &&
    add "judges used $NM model family(ies) ($USED_MODELS ); use at least $MODELS (set the Agent model for one judge)"
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
  awk -v r="$reason" "$CLAIM_AWK"' claim($0) { print "Goal result: partly met (judge consensus not reached: " r ")"; next } { print }' "$RETRO" >"$tmp" &&
    mv "$tmp" "$RETRO"
  rm -f "$COUNTER" "$WAITS"
  verdict_allow "$HOOK_ID" "gave up after $MAX_BLOCKS blocks; retro downgraded to partly met: $PROBLEMS"
fi
echo $((blocks + 1)) >"$COUNTER"

verdict_block "$HOOK_ID" "The goal says met, but it has no judge consensus yet: $PROBLEMS. Follow run-goal references/goal-judges.md as the last step, after the retro and the report: for each contract judge, print its prompt with \`$PROMPT_CMD\` and pass that output unchanged as the prompt of one fresh-context Agent call (not a fork; at least $MODELS model families). Then add a calibration line with session $SESSION_ID, the state, and the score to each judge's ## Calibration section. Every judge needs $MIN/10 or more, within $ROUNDS rounds. If you cannot reach it, apply the top fixes and judge all again, or change the retro to Goal result: partly met."
