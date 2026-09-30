#!/bin/bash
# Test fixture for checks/selectors-pure.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash selectors-pure.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# This is a BLOCK hook (verdict_block → exit 2): it blocks selector files
# (*.selector(s).ts(x) or anything under a selectors/ dir) that introduce
# impure operations (Date.now, Math.random, fetch, localStorage, ...). Test
# files are exempt. A violation exits 2 with "[hook selectors-pure] ..." on
# stderr. The documented event is PreToolUse.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/selectors-pure.sh"
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

# Test 1: pure selector (no impure ops) → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/user.selector.ts","content":"import { createSelector } from \"reselect\";\nexport const selectUser = (state) => state.user;\nexport const selectNames = createSelector(selectUser, (u) => Object.values(u));"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (pure selector)" 0 "$TEST1_EXIT"

# Test 2: *.selector.ts Write with Date.now() → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/user.selector.ts","content":"export const selStamp = (s) => Date.now();"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (Date.now in selector → block)" 2 "$TEST2_EXIT"
assert_stderr_contains "Test 2 stderr (block path reached)" "selectors-pure" "$TEST2_ERR"

# Test 3: file under selectors/ dir, Edit adds Math.random() → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/selectors/user.ts","old_string":"","new_string":"export const r = () => Math.random();"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (Math.random under selectors/ → block)" 2 "$TEST3_EXIT"

# Test 4: *.selectors.ts (plural) Write with fetch() → block (exit 2)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/api.selectors.ts","content":"export const f = () => fetch(\"/x\");"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (fetch in *.selectors.ts → block)" 2 "$TEST4_EXIT"

# Test 5: impure op in a NON-selector file → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/user.ts","content":"export const now = () => Date.now();"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-selector file out of scope)" 0 "$TEST5_EXIT"

# Test 6: impure op in a selector TEST file → bypass (mocking allowed)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/user.selector.test.ts","content":"export const t = () => Date.now();"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (selector test file exempt)" 0 "$TEST6_EXIT"

# Test 7: non-Write/Edit tool bypasses
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (non-Write/Edit tool bypasses)" 0 "$TEST7_EXIT"

# Test 8: bypass env var honored on violating content → exit 0
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/user.selector.ts","content":"export const selStamp = (s) => Date.now();"}}'
TEST8_EXIT=$(HOOK_BYPASS_SELECTORS_PURE=1 bash -c "echo '$TEST8_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (HOOK_BYPASS env var allows)" 0 "$TEST8_EXIT"

# Report
echo ""
echo "selectors-pure.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
