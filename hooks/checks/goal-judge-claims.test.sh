#!/usr/bin/env bash
# Fast proof for the goal-judge claim check and the judge contract filter.
# Runs in seconds (no transcripts, no state tokens), so a judge with a short
# budget can check done-when claims without the full goal-judges suite.
# Usage: bash hooks/checks/goal-judge-claims.test.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/goal-judges-before-stop.sh"
PROMPT_SH="$DIR/../lib/goal-judge-prompt.sh"
# The claim program, read from the hook itself so this test cannot drift.
eval "$(awk "/^readonly CLAIM_AWK='/ { on = 1 } on { print } on && /}'\$/ { exit }" "$HOOK")"
PASS=0
FAIL=0
is_claim() { printf '%s\n' "$1" | awk "$CLAIM_AWK"' claim($0) { c = 1 } END { exit !c }'; }
want() { # claim|ok, line
  local got=ok
  is_claim "$2" && got=claim
  if [ "$got" = "$1" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: '$2' read as $got, want $1"; fi
}

# Round-13 phrasings: text after a not-met word reads as a claim.
for l in "Goal result: partly met, ready to merge" "Goal result: partly met - everything works now" \
  "Goal result: unmet; resolved" "Goal result: stopped; fixed" "Goal result: not met, but it works" \
  "Goal result: failed, nothing left to do" "Goal result: met" "Goal result: blocked? no, met"; do
  want claim "$l"
done
# Honest not-met forms: a bracketed reason, a count, or "on <what>" for a wait.
for l in "Goal result: partly met (lowest 6/10)" "Goal result: not met" "Goal result: blocked on 2FA" \
  "Goal result: partly met: criteria 1 and 2 met, 3 blocked" "Goal result: blocked: 2 of 4 criteria met" \
  "Goal result: in progress (waiting on 1 judge(s); write the result again after the verdicts)" \
  "Goal result: partly met (lowest 6/10 (round 13))" "Goal result: failed (could not reproduce)"; do
  want ok "$l"
done
# Round-2 blockers: a success word after "on|by|until|for" still claims;
# the documented count forms and a not-met reason tail still allow.
for l in "Goal result: blocked on 2FA and done" "Goal result: in progress on the merge and it is met" \
  "Goal result: blocked on everything is complete" "Goal result: stopped by the owner, all shipped"; do
  want claim "$l"
done
for l in "Goal result: partly met: 3/5 met" "Goal result: partly met 3/5 met" "Goal result: not met: 3/5 met" \
  "Goal result: partly met: 3 of 5 criteria met" "Goal result: stopped by the owner" \
  "Goal result: failed for lack of budget"; do
  want ok "$l"
done
# Round-4 follow-up: an honest count with "rest blocked", or the lowest
# score, still allows; any other score still claims.
for l in "Goal result: unmet; 2 of 5 criteria met, rest blocked" "Goal result: not met - lowest 6/10" \
  "Goal result: partly met: 3/5 met, the rest open"; do
  want ok "$l"
done
want claim "Goal result: partly met - 9/10"
# Round-5 blocker: a not-met word with an all-met count says the goal is met.
for l in "Goal result: partly met: 5 of 5 met" "Goal result: stopped; 5 of 5 met" \
  "Goal result: unmet; 3 of 3 criteria met" "Goal result: failed; 3 of 3 criteria met" \
  "Goal result: not met: 4/4 met"; do
  want claim "$l"
done
# A completion claim still counts inside a bracketed reason.
want claim "Goal result: partly met (5 of 5 met)"
want claim "Goal result: partly met (all done)"
want claim "Goal result: not met (merged)"
want ok "Goal result: not met (tests passed, PR unmerged)"

# The hook's give-up line strips brackets from its cut reason, so a cut
# inside "family(ies) ( sonnet h" still reads as not met.
reason="$(printf '%s' 'judges used 2 model family(ies) ( sonnet h' | tr -d '\n()')"
want ok "Goal result: partly met (judge consensus not reached: $reason)"
want claim "Goal result: partly met (judge consensus not reached: judges used 2 model family(ies) ( sonnet h)"

# Contract filter: score targets go; plain lines with number words inside
# other words stay.
tc="$(mktemp "${TMPDIR:-/tmp}/gjc.XXXXXX")"
printf '%s\n' 'Success: lowest judge score >= 8' 'Pass mark: eight of ten from all judges' 'Success: scores of 8 minimum' \
  'Success: all judges 9 or better' 'Pivot: lowest effective score 5 or less' \
  'The README is done and the content is written; the judge reviewed it.' >"$tc"
out="$(bash "$PROMPT_SH" --contract-text "$tc")"
rm -f "$tc"
# Round-4 follow-ups: more target forms go; plain lines with target words
# inside other words, or with no number after them, stay.
tc="$(mktemp "${TMPDIR:-/tmp}/gjc.XXXXXX")"
printf '%s\n' 'Success: every judge scores 8+' 'Success: judges give no less than 8' 'Pass: a passing grade of eight' \
  'Raise judge score to nine' 'Pass mark: 8' 'The judge score must exceed seven' 'Goal: score ≥ 9' \
  'Success: every judge reaches 8' >"$tc"
out2="$(bash "$PROMPT_SH" --contract-text "$tc")"
n2="$(grep -c 'judge scores removed' <<<"$out2" || true)"
if [ "$n2" = 8 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n2 of 8 new score targets removed"; grep -v 'judge scores removed' <<<"$out2" | sed 's/^/    kept: /'; fi
printf '%s\n' 'Judges read 3 files; the sidebar lists them' 'File one task per follow-up the judge lists above the verdict' \
  'Each judge labels every defect; the runner fixes all in one batch, on target' 'Judges: sre-2, devex-bar, llm-eval' \
  'Judged paths: /a/wt/ab-judge2/target/x.sh' '2. The judge prompt keeps the README line -> proof: test 3' >"$tc"
out3="$(bash "$PROMPT_SH" --contract-text "$tc")"
rm -f "$tc"
n3="$(grep -c 'judge scores removed' <<<"$out3" || true)"
if [ "$n3" = 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n3 plain lines hidden"; fi
# Goal iteration 2: a bare "reach N" score target goes; "reach N users" stays.
tc="$(mktemp "${TMPDIR:-/tmp}/gjc.XXXXXX")"
printf '%s\n' '1. Reach 8.0 within two rounds.' 'Reach 8 after one iteration' 'Goal: reach 9.' >"$tc"
out4="$(bash "$PROMPT_SH" --contract-text "$tc")"
printf '%s\n' 'Reach 3 users in the pilot' 'The doc must reach 2 teams' >"$tc"
out5="$(bash "$PROMPT_SH" --contract-text "$tc")"
rm -f "$tc"
n4="$(grep -c 'judge scores removed' <<<"$out4" || true)"
if [ "$n4" = 3 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n4 of 3 bare reach targets removed"; fi
n5="$(grep -c 'judge scores removed' <<<"$out5" || true)"
if [ "$n5" = 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n5 plain reach lines hidden"; fi
n="$(grep -c 'judge scores removed' <<<"$out" || true)"
if [ "$n" = 5 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n of 5 score targets removed"; fi
if grep -q 'content is written' <<<"$out"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: a plain line was hidden"; fi

# Goal iteration 4 (the pivot): a blocker must break a done-when criterion
# or the owner request; a field standard alone does not cap a score.
for f in "$PROMPT_SH" "$DIR/../lib/goal-overseer-prompt.sh"; do
  if grep -q 'safety standard' "$f"; then FAIL=$((FAIL + 1)); echo "  FAIL: $(basename "$f") lets a field standard cap a score"; else PASS=$((PASS + 1)); fi
done
# Goal iteration 5: a rule the owner set (such as the 8, 8, 7 pass rule)
# is never a blocker.
for f in "$PROMPT_SH" "$DIR/../lib/goal-overseer-prompt.sh"; do
  if grep -q 'A rule the owner set is never a blocker' "$f"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $(basename "$f") lets a judge block on an owner rule"; fi
done
# A pipe into an awk that exits early sends SIGPIPE to the writer, and
# set -euo pipefail then kills the hook (exit 141) on a long transcript.
n=$(grep -cE "\| *awk[^|]*; *exit *\}" "$DIR/goal-judges-before-stop.sh" || true)
if [ "$n" = 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n pipes into an early-exit awk can SIGPIPE the hook"; fi
# Fast copies of the done-when prompt checks (the full suite runs them on
# real prompts), so a judge with a short budget can confirm them in seconds.
has() { # label, file, fixed text
  if grep -qF -- "$3" "$2"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $1"; fi
}
OV="$DIR/../lib/goal-overseer-prompt.sh"
has "judges list the worst bugs first, all in one round" "$PROMPT_SH" "Find the worst bugs first and list every fix now"
has "only a high-severity blocker caps a rubric line" "$PROMPT_SH" "Only a high-severity blocker caps a rubric line"
has "every listed fix has a severity and a check" "$PROMPT_SH" "Every fix you list, at any score, names its severity"
has "a later round adds deductions only for regressions" "$PROMPT_SH" "add a new deduction only for a regression or for code that changed since"
has "an unfinished check is unverified, not a deduction" "$PROMPT_SH" "is unverified, not a deduction"
has "a judge keeps one role for the whole goal" "$PROMPT_SH" 'basename "$CONTRACT" .contract.md | cksum'
has "judged paths are frozen at goal start" "$PROMPT_SH" 'PATHS_FILE="${CONTRACT%.contract.md}.paths"'
has "the overseer holds judges to their promise" "$OV" "Hold each judge to its earlier Path to 8"
has "the overseer lets only a high-severity blocker cap a score" "$OV" "Only a high-severity blocker caps a score"
has "a task-id-only notification binds to its judge" "$DIR/../lib/goal-judge-verdicts.jq" '$task2id'
has "one low judge gets a focused re-judge" "$DIR/goal-judges-before-stop.sh" "re-judge only \$LOWID"
has "an overseer with no tool calls cannot change a score" "$DIR/goal-judges-before-stop.sh" 'otools:-}" = 0'
has "the guide documents rounds per goal" "$DIR/../../skill-plugins/workflow/run-goal/references/goal-judges.md" "rounds per goal"
# The promise heading match, run on a numbered heading.
re="$(grep -oE "/\^\[#\*_ >-\]\*[^/]*Path to 8:/" "$OV" | head -1)"
for h in '### 5. Path to 8:' '**Path to 8:**' '## Path to 8:' '- **Path to 8:**' 'Path to 8:'; do
  if [ -n "$re" ] && printf '%s\n' "$h" | awk "$re {f=1} END {exit !f}"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: promise heading '$h' is not matched"; fi
done
echo "goal-judge-claims: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
