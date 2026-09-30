#!/bin/bash
# Test fixture for checks/tests-adapt-to-production.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash tests-adapt-to-production.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# This is a BLOCK hook (verdict_block → exit 2): it blocks production code
# (NOT test files) that adds test-accommodation wrappers — *ForTest /
# *ForTesting / __testX / lookup*Spy / defer*Until / wrap*ForTest / *MockX.
# A violation exits 2 with "[hook tests-adapt-to-production] ..." on stderr.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/tests-adapt-to-production.sh"
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

assert_stderr_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected stderr to contain '$needle'")
  fi
}

# Test 1: production code with normal functions → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"export const getUser = (state) => state.user;\nexport function computeTotal(items) { return items.length; }"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean production code)" 0 "$TEST1_EXIT"

# Test 2: production Write adds `export const lookupForTest` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"export const lookupForTest = () => state.value;"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (lookupForTest in prod → block)" 2 "$TEST2_EXIT"
assert_stderr_contains "Test 2 stderr (block path reached)" "tests-adapt-to-production" "$TEST2_ERR"

# Test 3: production Edit adds `export function __testReset` → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/state.ts","old_string":"","new_string":"export function __testReset() { count = 0; }"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (__testReset in prod Edit → block)" 2 "$TEST3_EXIT"

# Test 4: same wrapper but in a TEST file (out of scope) → bypass (exit 0)
TEST4_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"export const lookupForTest = () => state.value;"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (test file out of scope)" 0 "$TEST4_EXIT"

# Test 5: wrapper text in a non-code file (.md) → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/notes.md","content":"export const lookupForTest = () => state.value;"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-code file out of scope)" 0 "$TEST5_EXIT"

# Test 6: non-Write/Edit tool bypasses
TEST6_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-Write/Edit tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: bypass env var honored on violating content → exit 0
TEST7_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"export const lookupForTest = () => state.value;"}}'
TEST7_EXIT=$(HOOK_BYPASS_TESTS_ADAPT_TO_PRODUCTION=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "tests-adapt-to-production.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
