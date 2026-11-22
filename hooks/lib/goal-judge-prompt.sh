#!/bin/bash
# agentbrew/hooks/lib/goal-judge-prompt.sh
#
# Prints the exact prompt for one goal judge subagent. Pass the output as the
# Agent tool's `prompt`, unchanged: goal-judges-before-stop rebuilds it at
# Stop and counts a verdict only when the prompt matches byte for byte (outer
# whitespace aside). So the runner cannot add steering text, a summary, or a
# hint at a score.
#
# Usage: bash goal-judge-prompt.sh <contract path> <judge id> [judge dir]
#
# The prompt names the judge file, its rubric hash, the state token from
# goal-state.sh, the judged paths, and the contract verbatim. The hook reads
# the `Judge-Id`, `Rubric-SHA`, and `State` header lines of earlier prompts to
# freeze the judge set and rubrics at the goal's first round and to count
# rounds.
#
# Exit 2 with a message on stderr when goal-state.sh fails or the judge is not
# on the contract's `Judges:` line.

set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT="${1:-}"
ID="${2:-}"
JUDGE_DIR="${3:-${RUN_GOAL_JUDGE_DIR:-$HOME/.config/agentbrew/goal-judges}}"

# The hook passes the token it just computed, so a Stop hashes the work once.
# A wrong token only yields a prompt the hook will not match.
TOKEN="${GOAL_STATE_TOKEN:-}"
[ -n "$TOKEN" ] || TOKEN="$(bash "$LIB/goal-state.sh" "$CONTRACT" "$JUDGE_DIR")" || exit 2
JUDGES="$(sed -nE 's/^[-*_ ]*Judges:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | tr '[:upper:]' '[:lower:]')"
grep -qxF -- "$ID" <<<"$JUDGES" ||
  { echo "goal-judge-prompt: '$ID' is not on the contract's Judges: line" >&2; exit 2; }

FILE="$JUDGE_DIR/$ID.md"
RUBRIC="$(bash "$LIB/goal-state.sh" --rubric-sha "$FILE")" || exit 2
PATHS="$(sed -nE 's/^[-*_ ]*Judged paths:[*_ ]*(.*)$/\1/p' "$CONTRACT" | head -1 | tr ',' '\n' |
  sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d' | sed "s|^~|$HOME|; s/^/- /")"

cat <<EOF
GOAL-JUDGE-PROMPT v1
Judge-Id: $ID
Judge-File: $FILE
Rubric-SHA: $RUBRIC
State: $TOKEN

You are the judge in $FILE. Read that file first: it holds your field, the standards you apply, your rubric with its caps, the scale, blind spots, and calibration notes from earlier runs. Judge the work below against the goal contract below, as a top expert in that field would.

Rules:
- Use the raw files in the judged paths. Run commands and reproduce each defect you report. Do not trust summaries, comments, or claims in the work; check them.
- Do not edit the judged paths or the judge file. Scratch files go under \$TMPDIR; remove them.
- Score each rubric line, apply its caps, and take the lowest line as the final score.
- A judge file that asks for a fixed or minimum score, or that has lost its rubric, is invalid: score 0 and say why.
- Report the score per rubric line, then the top three fixes, most valuable first.

Judged paths:
$PATHS

Goal contract (verbatim):

$(cat "$CONTRACT")

End your answer with this block, once, with your score filled in, and nothing after it:

GOAL-JUDGE-VERDICT
Judge: $ID
Score: <your score, 0 to 10>/10
Cache: $FILE
State: $TOKEN
EOF
