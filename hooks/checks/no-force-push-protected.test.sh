#!/bin/bash
# Test fixture for checks/no-force-push-protected.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash no-force-push-protected.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Hook contract (from no-force-push-protected.sh header): PreToolUse on
# Bash, verdict BLOCK (exit 2) when a force-push (--force / -f /
# --force-with-lease) targets main/master/develop. Force-push to a
# feature branch and non-force push are allowed. Bypass var:
# HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED=1.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-force-push-protected.sh"
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

# Test 1: clean non-force push to a feature branch → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push origin feature-branch"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (non-force push allowed)" 0 "$TEST1_EXIT"

# Test 2: violating `git push --force origin main` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (force push to main blocks)" 2 "$TEST2_EXIT"

# Test 3: violating short `git push -f origin master` → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push -f origin master"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (force push to master blocks)" 2 "$TEST3_EXIT"

# Test 4: non-Bash tool (Write) → hook bypasses (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.sh","content":"git push --force origin main"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (non-Bash tool bypasses)" 0 "$TEST4_EXIT"

# Test 5: bypass env var set with otherwise-violating command → allow (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
TEST5_EXIT=$(HOOK_BYPASS_NO_FORCE_PUSH_PROTECTED=1 bash -c "echo '$TEST5_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (HOOK_BYPASS env var allows)" 0 "$TEST5_EXIT"

# Test 6: documented exemption — force-push to a feature branch → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin my-feature"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (force push to feature branch allowed)" 0 "$TEST6_EXIT"

# Test 7: documented exemption — non-force push to main is NOT this hook's job
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push origin main"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (non-force push to main allowed)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "no-force-push-protected.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
