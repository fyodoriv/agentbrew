#!/bin/bash
# Test fixture for checks/manual-test-steps-start-at-app-url.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash manual-test-steps-start-at-app-url.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): block → exit 2, allow/bypass → exit 0.
# The hook fires on `gh pr create` / `gh pr edit`. When the command has a
# test-plan section header (## Test plan / ## Manual test steps / ...) it
# blocks unless an app URL (app.example.com / localhost / 127.0.0.1) also
# appears. The hook greps the whole command, so a real `\n` is fine here.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/manual-test-steps-start-at-app-url.sh"
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

# Test 1: test-plan section whose first step is an app URL → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"add releases tab\" --body \"## Test plan\n1. Open https://staging.app.example.com/releases\n2. Confirm the tab renders\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (test plan starts at app URL)" 0 "$TEST1_EXIT"

# Test 2: test-plan section with a localhost URL → allow (local-only context)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Manual test steps\n1. Open http://localhost:3000\n2. Click the button\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (localhost URL allowed)" 0 "$TEST2_EXIT"

# Test 3: test-plan section whose first step is local setup, no URL → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"add releases tab\" --body \"## Test plan\n1. yarn install\n2. yarn dev\n3. Open the app\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (setup-first, no URL)" 2 "$TEST3_EXIT"

# Test 4: "## How to test" section with no URL anywhere → block
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## How to test\n- Pull the branch\n- Run yarn test\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (How to test, no URL)" 2 "$TEST4_EXIT"

# Test 5: no test-plan section at all → bypass (separate enforcement path)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\nFix the foo because the bar broke\""}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (no test-plan section bypasses)" 0 "$TEST5_EXIT"

# Test 6: not gh pr create/edit (gh pr view) → bypass
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 123"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (gh pr view bypasses)" 0 "$TEST6_EXIT"

# Test 7: non-Bash tool → bypass
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.md","content":"## Test plan\n1. yarn install"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (non-Bash tool bypasses)" 0 "$TEST7_EXIT"

# Test 8: bypass env var honored even on a violating command → exit 0
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Test plan\n1. yarn install\n2. yarn dev\""}}'
TEST8_EXIT=$(HOOK_BYPASS_MANUAL_TEST_STEPS_START_AT_APP_URL=1 bash -c "echo '$TEST8_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (HOOK_BYPASS env var allows)" 0 "$TEST8_EXIT"

# Report
echo ""
echo "manual-test-steps-start-at-app-url.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
