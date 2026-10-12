#!/bin/bash
# Test fixture for checks/gh-pr-body-related-prs-not-first.sh

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-related-prs-not-first.sh"
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

# Test 1: Related PRs first → block
TEST1='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Related PRs\\n- #100\\n\\n## Summary\\nAdds skill\""}}'
assert_exit_code "Test 1 (Related PRs first)" 2 "$(run_hook "$TEST1" | tail -1)"

# Test 2: Summary first, Related PRs later → allow
TEST2='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nAdds skill\\n\\n## Tests\\n- vitest\\n\\n## Related PRs\\n- #100\""}}'
assert_exit_code "Test 2 (Related PRs near bottom)" 0 "$(run_hook "$TEST2" | tail -1)"

# Test 3: no Related PRs → allow
TEST3='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix because PROJ-123\""}}'
assert_exit_code "Test 3 (no Related PRs)" 0 "$(run_hook "$TEST3" | tail -1)"

# Test 4: not gh pr → bypass
TEST4='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
assert_exit_code "Test 4 (not gh pr)" 0 "$(run_hook "$TEST4" | tail -1)"

# Test 5: --body-file takes the early-allow branch (reason says so).
# A pattern like '--body-file' must not be parsed as a grep option, or the
# branch is skipped and the reason falls through to "no --body arg detected".
FIXTURE_HOME="$(mktemp -d)"
TEST5='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title t --body-file /tmp/body.md"}}'
echo "$TEST5" | HOME="$FIXTURE_HOME" bash "$SCRIPT" >/dev/null 2>&1
assert_exit_code "Test 5 (--body-file exit)" 0 "$?"
LOG_TEXT="$(cat "$FIXTURE_HOME/.cache/agentbrew/hook-decisions.jsonl" 2>/dev/null || true)"
if [[ "$LOG_TEXT" == *"--body-file used"* ]]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 5 (--body-file branch): reason missing '--body-file used', got: $LOG_TEXT")
fi
rm -rf "$FIXTURE_HOME"

if [ "$FAIL" -eq 0 ]; then
  echo "gh-pr-body-related-prs-not-first.sh: $PASS passed, $FAIL failed"
  exit 0
fi

echo "gh-pr-body-related-prs-not-first.sh: $PASS passed, $FAIL failed"
for detail in "${FAIL_DETAILS[@]}"; do
  echo "  - $detail"
done
exit 1
