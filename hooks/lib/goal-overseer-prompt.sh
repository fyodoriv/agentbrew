#!/bin/bash
# agentbrew/hooks/lib/goal-overseer-prompt.sh
#
# Prints the exact prompt for the overseer of one judging round. The overseer
# is one more fresh-context Agent call, run after the judges on the same
# state. It checks each judge's report, corrects a score by at most 2 points
# with a reason, splits defects into blockers and follow-ups, and keeps the
# work moving. goal-judges-before-stop rebuilds this prompt from the
# transcript and counts the overseer only when the prompt matches byte for
# byte (outer whitespace aside), so the runner cannot trim or edit a judge's
# report before the overseer reads it.
#
# Usage:
#   bash goal-overseer-prompt.sh <contract path> <transcript path>
#   bash goal-overseer-prompt.sh <contract path> -   (J rows on stdin; the hook)
# A J row is: J <tab> <tool_use_id> <tab> <judge id> <tab> <state> <tab> <report, base64>
# (from goal-judge-verdicts.jq). The first report per judge on the current
# state is used, in the order of the contract's Judges: line.
#
# Exit 2 with a message on stderr when goal-state.sh fails or a judge on the
# Judges: line has no report on the current state.

set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT="${1:-}"
SRC="${2:-}"
JUDGE_DIR="${RUN_GOAL_JUDGE_DIR:-$HOME/.config/agentbrew/goal-judges}"
. "$LIB/stdin-json.sh"

TOKEN="${GOAL_STATE_TOKEN:-}"
[ -n "$TOKEN" ] || TOKEN="$(bash "$LIB/goal-state.sh" "$CONTRACT" "$JUDGE_DIR")" || exit 2
CONTRACT_SHA="${GOAL_CONTRACT_SHA:-}"
[ -n "$CONTRACT_SHA" ] || CONTRACT_SHA="$(bash "$LIB/goal-state.sh" --file-sha "$CONTRACT")" || exit 2
JUDGES="$(sed -nE 's/^[-*_ ]*Judges:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | tr '[:upper:]' '[:lower:]')"
OWNER_FILE="${CONTRACT%.contract.md}.owner.md"
OWNER_TEXT="(no owner file; judge against the contract only)"
[ "$OWNER_FILE" != "$CONTRACT" ] && [ -f "$OWNER_FILE" ] && OWNER_TEXT="$(cat "$OWNER_FILE")"
PATHS="$(sed -nE 's/^[-*_ ]*Judged paths:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | sed "s|^~|$HOME|; s/^/- /")"

if [ "$SRC" = "-" ]; then
  JROWS="$(cat)"
elif [ -n "$SRC" ] && [ -f "$SRC" ]; then
  JROWS="$(hook_jq -R -r -n --argjson canon '{}' --arg lib "$LIB" --arg contract "$CONTRACT" --arg mode all \
    -f "$LIB/goal-judge-verdicts.jq" <"$SRC" 2>/dev/null | awk -F'\t' '$1=="J"')"
else
  echo "goal-overseer-prompt: pass a transcript path, or - with J rows on stdin" >&2; exit 2
fi

REPORTS=""
while IFS= read -r id; do
  [ -n "$id" ] || continue
  b64="$(printf '%s\n' "$JROWS" | awk -F'\t' -v j="$id" -v t="$TOKEN" '$1=="J" && $3==j && $4==t {print $5; exit}')"
  [ -n "$b64" ] || { echo "goal-overseer-prompt: no report from $id on state $TOKEN; run every judge first" >&2; exit 2; }
  text="$(printf '%s' "$b64" | hook_jq -Rr '@base64d' 2>/dev/null)"
  REPORTS="$REPORTS
=== Judge $id ===
$text
"
done <<<"$JUDGES"
# Each judge's promise from its latest earlier report: the last "Path to 8:"
# line and what follows it, bold sub-labels included, up to the verdict block
# or the next heading, so the overseer can hold the judge to it.
PROMISES=""
while IFS= read -r id; do
  [ -n "$id" ] || continue
  b64="$(printf '%s\n' "$JROWS" | awk -F'\t' -v j="$id" -v t="$TOKEN" '$1=="J" && $3==j && $4!=t {v = $5} END {print v}')"
  [ -n "$b64" ] || continue
  path="$(printf '%s' "$b64" | hook_jq -Rr '@base64d' 2>/dev/null | awk '/^GOAL-JUDGE-VERDICT/ {exit} /^[#*_ >-]*([0-9]+[.)][ \t]*)?[*_]*Path to 8:/ {buf = $0 "\n"; on = 1; next} on {buf = buf $0 "\n"} END {printf "%s", buf}')"
  [ -n "$path" ] && PROMISES="$PROMISES
=== Judge $id, earlier round ===
$path
"
done <<<"$JUDGES"
[ -n "$PROMISES" ] || PROMISES="
(none: no judge gave a Path to 8 in an earlier round)
"
RULINGS="$(while IFS= read -r id; do [ -n "$id" ] && printf 'Ruling %s: <corrected score, 0 to 10>/10 - <one-line reason>\n' "$id"; done <<<"$JUDGES")"

cat <<EOF
GOAL-OVERSEER-PROMPT v1
Contract-SHA: $CONTRACT_SHA
State: $TOKEN

You are the overseer of one judging round. You did not judge the work. Your job is to keep the judging fair and the work moving at a reasonable pace.

Read the judge reports below, the owner request, the goal contract, and the raw files in the judged paths.

For each judge:
- Check each deduction. It stands only if the judge reproduced the defect, it is in scope of the owner request and the contract's Done when, and it is not about a step that can only happen after judging (merge, install, release).
- Check for misses: a defect you reproduce that the judge missed, and that its rubric covers.
- Correct the score by at most 2 points, up or down, with one reason. Lower it for a reproduced miss; raise it only for a deduction that fails the checks above, with a reason of 20 or more characters that names that deduction; keep it when the judge was right.

Pace:
- Split every defect into blockers (break a done-when criterion or the owner request) and follow-ups (any other improvement: file as tasks). A rule the owner set is never a blocker: that includes the pass rule, where one of three or more judges may sit one point under the bar. Give each blocker a severity: high when it lets a false result pass, loses a verdict, traps the agent with no exit, or leaves a done-when criterion unmet; low otherwise. Only a high-severity blocker caps a score; a deduction for a low blocker or a follow-up fails the scope check, so raise that score, and list those as tasks to file.
- List the high-severity blockers as a numbered list. The runner fixes all of them, each with a test, before the next round, so name each one precisely enough to test.
- Name the smallest set of fixes that would get every judge to the bar, and flag any demand that is out of scope or would take more than one more round.
- Hold each judge to its earlier Path to 8 (below). A deduction that is not in that promise stands only for a regression or for code that changed since; otherwise raise it. When the promised fixes are done and their checks pass, the judge's corrected score is at least 8 unless you reproduce a regression.
- Check each judge's new Path to 8: every item must be specific and have a check. Write one merged Path to 8 for the runner, so the next round is not a guess.

Rules:
- Run commands and reproduce what you rely on. Do not trust summaries or claims in the work, the contract, or the reports.
- Do not read the judge folder. Do not edit the judged paths. Scratch files go under \$TMPDIR; remove them.
- Budget: finish within 10 minutes and about 20 tool calls.

Judged paths:
$PATHS

Owner request (verbatim from the /goal command):

$OWNER_TEXT

Goal contract (written by the runner; the After judging section and score targets are left out):

$(bash "$LIB/goal-judge-prompt.sh" --contract-text "$CONTRACT")

Earlier promises (each judge's latest "Path to 8:" from an earlier round, verbatim):
$PROMISES
Judge reports (verbatim, from the transcript):
$REPORTS
End your answer with this block, once, filled in, and nothing after it:

GOAL-OVERSEER-VERDICT
State: $TOKEN
$RULINGS
EOF
