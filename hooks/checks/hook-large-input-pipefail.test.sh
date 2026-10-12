#!/bin/bash
# Fixture: hooks must reach the right verdict when the checked content is
# larger than the OS pipe buffer (64 KB). Under `set -o pipefail`, an early
# `printf | grep -q` exit SIGPIPEs the writer (status 141) and the check
# looks like "no match"; `grep | head -1` can abort the script instead.
# Task: hooks-grep-pipefail-audit.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0
FAIL_DETAILS=()

# run_case <label> <script> <file_path> <first_line> <repeat_violation 0|1> <expected_exit> [stderr_needle]
run_case() {
  local label="$1" script="$2" file_path="$3" first="$4" repeat="$5" expected="$6" needle="${7:-}"
  local body input out err rc
  if [ "$repeat" = "1" ]; then
    body="$(yes "$first" | head -c 300000)"
  else
    body="$first"$'\n'"$(head -c 300000 /dev/zero | tr '\0' 'a')"
  fi
  input="$(jq -n --arg p "$file_path" --arg c "$body" \
    '{hook_event_name:"PostToolUse",tool_name:"Write",tool_input:{file_path:$p,content:$c}}')"
  err="$(mktemp)"
  out="$(printf '%s' "$input" | bash "$DIR/$script" 2>"$err")"
  rc=$?
  : "$out"
  if [ "$rc" != "$expected" ]; then
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $rc")
  elif [ -n "$needle" ] && ! grep -q "$needle" "$err"; then
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: stderr missing '$needle'")
  else
    PASS=$((PASS + 1))
  fi
  rm -f "$err"
}

for repeat in 0 1; do
  tag="first-line-only"
  [ "$repeat" = "1" ] && tag="every-line"
  run_case "code-no-timestamps ($tag)" code-no-timestamps.sh /repo/src/foo.ts '// 2026-05-27 dated' "$repeat" 2 "2026-05-27"
  run_case "selectors-pure ($tag)" selectors-pure.sh /repo/src/user.selector.ts 'export const s = () => Date.now();' "$repeat" 2 "Date.now"
  run_case "tests-adapt-to-production ($tag)" tests-adapt-to-production.sh /repo/src/foo.ts 'export const lookupForTest = () => 1;' "$repeat" 2 "lookupForTest"
  run_case "pending-internal-work ($tag)" pending-internal-work-needs-ticket.sh /repo/src/foo.ts '// TODO fix later' "$repeat" 0 "without a ticket"
done

echo ""
echo "hook-large-input-pipefail: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
