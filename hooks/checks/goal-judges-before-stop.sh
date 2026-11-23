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
# A goal may end as "met" only with a judge consensus. The hook is
# success-gated: while a goal contract exists, Stop is allowed only when each
# judge the contract names has exactly one verdict for the current state, each
# scored at least the minimum (default 8 of 10), or when the retro says plainly
# that the goal is not met.
#
# **Not met**: the retro has a `Goal result` line and every such line
# starts with a whole not-met phrase (hyphens read as spaces): partly met,
# partially met, not met, not yet met, unmet, failed, abandoned, cancelled,
# stopped, in progress, blocked, impossible, or pending. After in progress,
# blocked, impossible, or pending, the rest of the line (outside parentheses
# and counts like "2 of 4 criteria met") must not say "met" ("blocked? no,
# met" is a claim). Mid-goal
# Stops (a question round, a wait) need `Goal result: in progress (<why>)`.
#
# **Claim**: anything else: no retro, no `Goal result` line, or a `Goal
# result` line (after list, heading, quote, bold, or number marks) in any
# other form ("met", "fully met", "done").
#
# **Contract**: `Judges: <id>, <id>, <id>` and `Judged paths: <path>, ...`.
# A goal is active when the transcript's last `/goal` command with an argument
# set one. A missing contract file during an active goal blocks (deleting it
# is not a way out).
#
# **Owner text**: the hook writes the `/goal` argument from the transcript,
# which the runner cannot edit, to `<session>.owner.md` before it builds the
# judge prompts, so an edited owner file only yields prompts that do not match.
#
# **State token**: `lib/goal-state.sh <contract>` hashes the contract, each
# judge's rubric (its file up to `## Calibration`), and the judged paths (git
# HEAD, status, diff, untracked files). Any edit by any tool changes it. A
# verdict counts only when its `State:` equals the token now. goal-state.sh
# also refuses a judge file below the rubric floor.
#
# **Prompt**: each judge call's prompt must equal the output of
# `lib/goal-judge-prompt.sh <contract> <id>` (outer whitespace aside), so the
# runner cannot add steering text. The prompt holds the rubric, so the judge
# never reads the runner-written calibration notes. Leave `subagent_type`
# out, or set it to `general-purpose`: a fork shares the runner's context and
# a custom agent type brings its own system prompt. A judge that got a
# SendMessage after launch does not count, and any unofficial judge run (an
# Agent call with the judge markers but no header, or `claude -p`/`codex exec`
# in Bash with them) blocks: practice runs would let the runner tune the work
# to the judges outside the round cap.
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
# **Rounds**: the judge prompts in the transcript freeze the judge set, each
# rubric hash, and the contract hash at the goal's first round; a goal gets
# `RUN_GOAL_JUDGE_ROUNDS` distinct judged states. Only the latest round can
# pass: reverting the work to an earlier passing state after a failing round
# blocks.
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
# `Goal result: partly met (judge consensus not reached: <reason>)` (and adds
# that line when the retro has none, creating the retro if needed), resets its
# counters, and allows, so a goal never reads as met without consensus.
#
# **Fails open** when: the bypass is set during an active goal, no goal is
# active (no `/goal`, or after `/goal clear`), the agent has no Stop hook
# (Codex), or the session id is unusable. Known limits, not closed: a
# lenient runner-written judge file (the rubric floor and the field-standard
# rule limit it), a paraphrased practice run with no marker, steering text in
# the runner-written contract (the prompt tells judges to report it), up to
# three rounds bought by small edits, and rubric loosening at the next goal.
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
readonly CLAIM_AWK='function norm(l) { l = tolower(l); gsub(/[*_`]/, "", l); sub(/^[[:space:]#>0-9.)-]*/, "", l); return l }
function result(l) { return norm(l) ~ /^goal result([^a-z]|$)/ }
function claim(l,  r) { l = norm(l)
  if (l !~ /^goal result([^a-z]|$)/) return 0
  r = substr(l, 12); sub(/^[^a-z]*/, "", r); gsub(/-/, " ", r)
  if (r ~ /^(partly met|partially met|not met|not yet met|unmet|failed|abandoned|cancelled|canceled|stopped)([^a-z]|$)/) return 0
  if (r !~ /^(in progress|blocked|impossible|pending)([^a-z]|$)/) return 1
  sub(/^(in progress|blocked|impossible|pending)/, "", r); gsub(/\([^)]*\)/, "", r)
  gsub(/[0-9]+ *(of|\/) *[0-9]+[^,;.]*met/, "", r)
  return r ~ /(^|[^a-z])met([^a-z]|$)/ }'

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
OWNER="$STATE_DIR/$SESSION_ID.owner.md"
PROMPT_CMD="bash $__HOOK_LIB_DIR/goal-judge-prompt.sh $CONTRACT <judge id>"

TRANSCRIPT="$(json_get "$INPUT" '.transcript_path')"
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || TRANSCRIPT=""
ROWS=""
parse() { [ -z "$TRANSCRIPT" ] || ROWS="$(hook_jq -R -r -n --argjson canon "$1" -f "$__HOOK_LIB_DIR/goal-judge-verdicts.jq" <"$TRANSCRIPT" 2>/dev/null || true)"; }
G_ACTIVE=0
if [ -n "$TRANSCRIPT" ] && grep -F -q '<command-name>/goal</command-name>' "$TRANSCRIPT" 2>/dev/null; then
  parse "{}"
  G_ACTIVE="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="G"{print $2; exit}')"
fi
# No contract and no active goal: nothing to judge. A contract with no
# readable transcript still gates (fail closed).
[ -f "$CONTRACT" ] || [ "$G_ACTIVE" = 1 ] || verdict_allow "$HOOK_ID" "no active goal contract"

if [ "${HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1"
fi

# Success-gated: only an explicit not-met result skips judging. No retro, no
# result line, or any claim line all need a consensus.
if [ -f "$RETRO" ] &&
  awk "$CLAIM_AWK"' result($0) { r = 1 } claim($0) { c = 1 } END { exit !(r && !c) }' "$RETRO"; then
  verdict_allow "$HOOK_ID" "goal says it is not met"
fi

count() { local n=0; [ -f "$1" ] && n="$(cat "$1" 2>/dev/null || echo 0)"; case "$n" in "" | *[!0-9]*) n=0 ;; esac; echo "$n"; }

PROBLEMS=""
add() { PROBLEMS="$PROBLEMS; $1"; }

if [ -f "$CONTRACT" ]; then
  JUDGES="$(sed -nE 's/^[-*_ ]*Judges:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
    sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | tr '[:upper:]' '[:lower:]' | LC_ALL=C sort -u)"
else
  JUDGES=""
fi
NJ="$(printf '%s\n' "$JUDGES" | sed '/^$/d' | wc -l | tr -d ' ')"
TOKEN=""
CANON="{}"
# The owner text comes from the transcript. Rewrite the owner file when it
# differs (whitespace aside), so the runner's prompts and the hook's agree.
G_OWNER="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="G"{print $3; exit}' | hook_jq -Rr '@base64d' 2>/dev/null || true)"
if [ "$G_ACTIVE" = 1 ] && [ -n "$G_OWNER" ]; then
  norm_ws() { tr -s '[:space:]' ' ' | sed -E 's/^ //; s/ $//'; }
  [ -f "$OWNER" ] && [ "$(norm_ws <"$OWNER")" = "$(printf '%s' "$G_OWNER" | norm_ws)" ] ||
    { mkdir -p "$STATE_DIR" && printf '%s\n' "$G_OWNER" >"$OWNER"; } 2>/dev/null || true
fi
if [ ! -f "$CONTRACT" ]; then
  add "the goal contract file is missing ($CONTRACT); save the contract there again, or write Goal result: partly met (<why>) in the retro"
elif [ "$NJ" -lt "$NEED" ]; then
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

[ "$CANON" = "{}" ] || parse "$CANON"
UROWS="$(printf '%s\n' "$ROWS" | awk -F'\t' '$1=="U"' | wc -l | tr -d ' ')"
[ "$UROWS" -gt 0 ] &&
  add "$UROWS unofficial judge run(s) (judge markers without the prompt header, or claude -p/codex exec); judge only with the exact goal-judge-prompt.sh output, in counted rounds"
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
  LAST_STATE="$(printf '%s\n' "$PROWS" | awk -F'\t' '{s=$5} END{print s}')"
  [ -z "$TOKEN" ] || [ "$LAST_STATE" = "$TOKEN" ] ||
    add "the latest judging round was on state $LAST_STATE, not the current state $TOKEN; only the latest round counts, so judge all again"
  FIRST_SET="$(printf '%s\n' "$PROWS" | awk -F'\t' -v s="$FIRST_STATE" '$5==s{print $3}' | LC_ALL=C sort -u)"
  [ "$FIRST_SET" = "$JUDGES" ] ||
    add "the judge set changed after the first round (first: $(printf '%s ' $FIRST_SET)now: $(printf '%s ' $JUDGES)); keep the first panel"
  FIRST_CONTRACT="$(printf '%s\n' "$PROWS" | awk -F'\t' 'NR==1{print $6}')"
  NOW_CONTRACT="$(bash "$__HOOK_LIB_DIR/goal-state.sh" --file-sha "$CONTRACT" 2>/dev/null || true)"
  [ -z "$FIRST_CONTRACT" ] || [ "$FIRST_CONTRACT" = "$NOW_CONTRACT" ] ||
    add "the goal contract changed after the first round; judge against the contract you started with"
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
MISSING=""
if [ -n "$TOKEN" ]; then
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    cache="$JUDGE_DIR/$id.md"
    mine="$(printf '%s\n' "$VROWS" | awk -F'\t' -v j="$id" -v t="$TOKEN" '$3==j && $6==t')"
    n="$(printf '%s\n' "$mine" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [ "$n" -eq 0 ]; then
      MISSING="$MISSING $id"; continue
    elif [ "$n" -gt 1 ]; then
      add "$id was judged $n times on one state (a re-roll); change the work, then judge all again"; continue
    fi
    IFS=$'\t' read -r _ _ _ score vcache _ model ok typeok msg <<<"$mine"
    [ "${vcache/#\~/$HOME}" = "$cache" ] || add "$id cites cache $vcache, not $cache"
    [ "$ok" = 1 ] || add "$id's prompt is not the exact output of goal-judge-prompt.sh for this state"
    [ "$typeok" = 1 ] || add "$id ran as a fork or a custom agent type; leave subagent_type out, or set it to general-purpose"
    [ "$msg" = 1 ] && add "$id got a SendMessage after launch (a message can steer a judge); run it again with no messages"
    case "$score" in bad | "") add "$id's Score line is not N/10"; continue ;; esac
    if awk -v a="$score" 'BEGIN{exit !(a>10)}'; then add "$id score $score is out of range"; continue; fi
    awk -v a="$score" -v m="$MIN" 'BEGIN{exit !(a<m)}' && add "$id scored $score/10"
    if [ -z "$LOWEST" ] || awk -v a="$score" -v b="$LOWEST" 'BEGIN{exit !(a<b)}'; then LOWEST="$score"; fi
    case " $USED_MODELS " in *" $model "*) ;; *) USED_MODELS="$USED_MODELS $model" ;; esac
    awk -v s="$SESSION_ID" -v t="$TOKEN" -v sc="$score/10" \
      '/^## Calibration/{c=1} c && index($0, s) && index($0, t) && index($0, sc){f=1} END{exit !f}' "$cache" 2>/dev/null ||
      add "$id's ## Calibration section has no line with session $SESSION_ID, state $TOKEN, and $score/10"
  done <<<"$JUDGES"
  [ -n "$MISSING" ] && add "no verdict for the current state $TOKEN from:$MISSING"
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
  src="$RETRO"; [ -f "$src" ] || src=/dev/null
  awk -v r="$reason" "$CLAIM_AWK"' BEGIN { line = "Goal result: partly met (judge consensus not reached: " r ")" }
    claim($0) { print line; s = 1; next } result($0) { s = 1 } { print } END { if (!s) print line }' "$src" >"$tmp" &&
    mv "$tmp" "$RETRO"
  rm -f "$COUNTER" "$WAITS"
  verdict_allow "$HOOK_ID" "gave up after $MAX_BLOCKS blocks; retro downgraded to partly met: $PROBLEMS"
fi
echo $((blocks + 1)) >"$COUNTER"

if [ -f "$RETRO" ] && awk "$CLAIM_AWK"' claim($0) { c = 1 } END { exit !c }' "$RETRO"; then
  OPEN="The retro has a Goal result line that is not a known not-met phrase, so it counts as met, and there is no judge consensus yet: $PROBLEMS. If the goal is not met, start the result with one of: partly met, not met, unmet, failed, abandoned, in progress, blocked, impossible, pending."
else
  OPEN="No Goal result line says the goal is not met, so this Stop needs a judge consensus. Mid-goal (a question round, a wait), write Goal result: in progress (<why>) in $RETRO and stop again. Missing: $PROBLEMS."
fi
verdict_block "$HOOK_ID" "$OPEN Follow run-goal references/goal-judges.md as the last step, after the retro and the report: for each contract judge, print its prompt with \`$PROMPT_CMD\` and pass that output unchanged as the prompt of one fresh-context Agent call (leave subagent_type out, or set it to general-purpose; at least $MODELS model families). Then add a calibration line with session $SESSION_ID, the state, and the score to each judge's ## Calibration section. Every judge needs $MIN/10 or more, within $ROUNDS rounds. If you cannot reach it, apply the top fixes and judge all again, or write Goal result: partly met (<lowest score and why>) in the retro."
