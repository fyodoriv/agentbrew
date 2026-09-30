#!/bin/bash
# Test fixture for checks/gh-pr-body-no-review-response.sh

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-no-review-response.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

assert_exit_code() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $actual")
  fi
}

run_hook() {
  local input="$1"
  echo "$input" | bash "$SCRIPT" 2>/dev/null
  echo $?
}

# Test 1: Qodo review - resolved section → block (exit 2)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 2213 --body \"## Summary\\n\\n## Qodo review - resolved\\n| Comment | Fix |\""}}'
assert_exit_code "Test 1 (Qodo review - resolved)" 2 "$(run_hook "$TEST1_INPUT" | tail -1)"

# Test 2: Reviewer feedback addressed → block
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix\\n\\n## Reviewer feedback addressed\\n- done\""}}'
assert_exit_code "Test 2 (Reviewer feedback addressed)" 2 "$(run_hook "$TEST2_INPUT" | tail -1)"

# Test 3: clean artifact-focused body → allow
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix because ticket PROJ-123\""}}'
assert_exit_code "Test 3 (clean body)" 0 "$(run_hook "$TEST3_INPUT" | tail -1)"

# Test 4: not gh pr → bypass
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
assert_exit_code "Test 4 (not gh pr)" 0 "$(run_hook "$TEST4_INPUT" | tail -1)"

if [ "$FAIL" -eq 0 ]; then
  echo "gh-pr-body-no-review-response.sh: $PASS passed, $FAIL failed"
  exit 0
fi

echo "gh-pr-body-no-review-response.sh: $PASS passed, $FAIL failed"
for detail in "${FAIL_DETAILS[@]}"; do
  echo "  - $detail"
done
exit 1
