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
n="$(grep -c 'judge scores removed' <<<"$out" || true)"
if [ "$n" = 5 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: $n of 5 score targets removed"; fi
if grep -q 'content is written' <<<"$out"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "  FAIL: a plain line was hidden"; fi

echo "goal-judge-claims: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
