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
n="$(grep -c 'judge scores removed' <<<"$out" || true)"
if [ "$n" = 5 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n of 5 score targets removed"; fi
if grep -q 'content is written' <<<"$out"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: a plain line was hidden"; fi

echo "goal-judge-claims: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
