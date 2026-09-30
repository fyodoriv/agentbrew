#!/bin/bash
# Test fixture for checks/comment-brevity-in-tests.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash comment-brevity-in-tests.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# comment-brevity-in-tests is a WARN hook (verdict_warn → exit 0). The
# meaningful signal for a violation is the "[hook ... WARN]" stderr line,
# so we assert exit 0 AND that stderr contains/excludes WARN. Threshold:
# MAX_COMMENT_LINES=3, so 4+ comment lines before it()/describe() warn.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/comment-brevity-in-tests.sh"
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

assert_stderr_excludes() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected stderr NOT to contain '$needle'")
  else
    PASS=$((PASS + 1))
  fi
}

# Test 1: short (1-line) comment before it() in a test file → allow
TEST1_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// one note\nit(\"works\", () => {});"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
TEST1_ERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 1 (1-line comment OK)" 0 "$TEST1_EXIT"
assert_stderr_excludes "Test 1 stderr (no warning)" "WARN" "$TEST1_ERR"

# Test 2: exactly 3 comment lines (boundary, count not > MAX=3) → allow
TEST2_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// a\n// b\n// c\nit(\"works\", () => {});"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (3-line boundary OK)" 0 "$TEST2_EXIT"
assert_stderr_excludes "Test 2 stderr (no warning)" "WARN" "$TEST2_ERR"

# Test 3: 4 comment lines before it() (count > 3) → warn (exit 0 + WARN)
TEST3_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// line 1\n// line 2\n// line 3\n// line 4\nit(\"works\", () => {});"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
TEST3_ERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 3 (long block Write → warn exits 0)" 0 "$TEST3_EXIT"
assert_stderr_contains "Test 3 stderr (warn path reached)" "WARN" "$TEST3_ERR"

# Test 4: Edit new_string, 4 comment lines before describe() in *.spec.ts → warn
TEST4_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/foo.spec.ts","old_string":"","new_string":"// a\n// b\n// c\n// d\ndescribe(\"suite\", () => {});"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
TEST4_ERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 4 (long block Edit → warn exits 0)" 0 "$TEST4_EXIT"
assert_stderr_contains "Test 4 stderr (warn path reached)" "WARN" "$TEST4_ERR"

# Test 5: same long block in a NON-test production file → bypass (out of scope)
TEST5_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// line 1\n// line 2\n// line 3\n// line 4\nit(\"works\", () => {});"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
TEST5_ERR=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 5 (non-test file out of scope)" 0 "$TEST5_EXIT"
assert_stderr_excludes "Test 5 stderr (no warning)" "WARN" "$TEST5_ERR"

# Test 6: non-Write/Edit tool bypasses
TEST6_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-Write/Edit tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: bypass env var honored on violating content → exit 0
TEST7_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// line 1\n// line 2\n// line 3\n// line 4\nit(\"works\", () => {});"}}'
TEST7_EXIT=$(HOOK_BYPASS_COMMENT_BREVITY_IN_TESTS=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "comment-brevity-in-tests.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
