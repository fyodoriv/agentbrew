#!/bin/bash
# Test fixture for checks/code-no-timestamps.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash code-no-timestamps.test.sh`
# (assumes you're in agentbrew/hooks/checks/).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/code-no-timestamps.sh"
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

# Test 1: Write with no timestamps → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"export const foo = 1;"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean Write)" 0 "$TEST1_EXIT"

# Test 2: Write with `// 2026-05-27` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"// 2026-05-27 added the foo\nexport const foo = 1;"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (Write with // 2026-05-27)" 2 "$TEST2_EXIT"

# Test 3: Edit with `# 2026-05-27` in new_string → block
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/foo.sh","old_string":"","new_string":"# 2026-05-27: refactor\nrun_thing"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (Edit with # 2026-05-27)" 2 "$TEST3_EXIT"

# Test 4: Edit with /* 2024-11-15 */ → block
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/foo.js","old_string":"","new_string":"/* 2024-11-15 */ function bar() {}"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (Edit with /* 2024-11-15 */)" 2 "$TEST4_EXIT"

# Test 5: Year-only reference is allowed (no full date)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"// 2026 refactor pass\nexport const foo = 1;"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (year-only reference allowed)" 0 "$TEST5_EXIT"

# Test 6: Markdown file is exempt
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/CHANGELOG.md","content":"## 2026-05-27\n- bug fixes"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (markdown exempt)" 0 "$TEST6_EXIT"

# Test 7: Bash tool is not Write/Edit, hook bypasses
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (non-Write/Edit tool bypasses)" 0 "$TEST7_EXIT"

# Test 8: Bypass env var honored
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"// 2026-05-27 dated comment"}}'
TEST8_EXIT=$(HOOK_BYPASS_CODE_NO_TIMESTAMPS=1 bash -c "echo '$TEST8_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (HOOK_BYPASS env var allows)" 0 "$TEST8_EXIT"

# Test 9: Empty content bypasses
TEST9_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":""}}'
TEST9_EXIT=$(echo "$TEST9_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST9_EXIT=$(echo "$TEST9_EXIT" | tail -1)
assert_exit_code "Test 9 (empty content bypasses)" 0 "$TEST9_EXIT"

# Report
echo ""
echo "code-no-timestamps.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
