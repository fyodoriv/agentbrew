#!/bin/bash
# Test fixture for checks/gh-pr-body-requires-validation.sh

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-requires-validation.sh"
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

FULL_BODY='## Requirements checklist\n- [x] item\n\n## Previous state\n1. before\n\n## Validation steps\n1. verify'

# Test 1: all three canonical sections → allow
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Requirements checklist\\n- [x] a\\n\\n## Previous state\\n1. before\\n\\n## Validation steps\\n1. verify\""}}'
TEST1_EXIT=0
echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null || TEST1_EXIT=$?
assert_exit_code "Test 1 (canonical sections)" 0 "$TEST1_EXIT"

# Test 2: alias headings → allow
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 42 --body \"## What this change is about\\n- [ ] todo\\n\\n## How to see previous state\\nsteps\\n\\n## How to validate this PR delivers the whole task\\nsteps\""}}'
TEST2_EXIT=0
echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null || TEST2_EXIT=$?
assert_exit_code "Test 2 (alias headings)" 0 "$TEST2_EXIT"

# Test 3: missing Validation steps → block
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Requirements checklist\\n- [x] a\\n\\n## Previous state\\n1. before\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (missing validation)" 2 "$TEST3_EXIT"

# Test 4: only Summary (no stacked trio) → block
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix because foo\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (Summary only)" 2 "$TEST4_EXIT"

# Test 4b: stacked skill trio → allow
TEST4B_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nShip phase B.\\n\\n## Delivery plan\\n| Step | PR |\\n\\n## Test plan\\n- [x] bash scripts/run-tests.sh\""}}'
TEST4B_EXIT=0
echo "$TEST4B_INPUT" | bash "$SCRIPT" 2>/dev/null || TEST4B_EXIT=$?
assert_exit_code "Test 4b (stacked skill trio)" 0 "$TEST4B_EXIT"

# Test 5: gh pr view → bypass
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 123"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (gh pr view bypasses)" 0 "$TEST5_EXIT"

# Test 6: bypass env var → allow violating body
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"ship it\""}}'
TEST6_EXIT=$(HOOK_BYPASS_GH_PR_BODY_REQUIRES_VALIDATION=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var)" 0 "$TEST6_EXIT"

# Test 7: --body-file with all sections → allow
BODY_FILE="$(mktemp)"
printf '%b' "$FULL_BODY" > "$BODY_FILE"
TEST7_INPUT="{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr create --body-file $BODY_FILE\",\"cwd\":\"$(pwd)\"}}"
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
rm -f "$BODY_FILE"
assert_exit_code "Test 7 (--body-file with sections)" 0 "$TEST7_EXIT"

echo ""
echo "gh-pr-body-requires-validation.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
