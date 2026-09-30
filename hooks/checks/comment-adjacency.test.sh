#!/bin/bash
# Test fixture for checks/comment-adjacency.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash comment-adjacency.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# comment-adjacency is a WARN hook: a violation calls verdict_warn (exit 0
# + "[hook ... WARN]" on stderr), so the meaningful signal is the WARN line,
# not the exit code. We assert exit 0 AND that stderr contains/excludes WARN.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/comment-adjacency.sh"
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

# Test 1: comment adjacent to const (no blank line) → allow (exit 0, no WARN)
TEST1_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// documents foo\nexport const foo = 1;"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
TEST1_ERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 1 (clean adjacent comment)" 0 "$TEST1_EXIT"
assert_stderr_excludes "Test 1 stderr (no warning)" "WARN" "$TEST1_ERR"

# Test 2: comment then BLANK line then const (orphaned) → warn (exit 0 + WARN)
TEST2_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// documents foo\n\nexport const foo = 1;"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (orphaned comment Write → warn exits 0)" 0 "$TEST2_EXIT"
assert_stderr_contains "Test 2 stderr (warn path reached)" "WARN" "$TEST2_ERR"

# Test 3: Edit new_string with comment, blank, function → warn
TEST3_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/bar.ts","old_string":"","new_string":"// helper for bar\n\nfunction bar() { return 1; }"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
TEST3_ERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 3 (orphaned comment Edit → warn exits 0)" 0 "$TEST3_EXIT"
assert_stderr_contains "Test 3 stderr (warn path reached)" "WARN" "$TEST3_ERR"

# Test 4: markdown file is out of scope → bypass (exit 0, no WARN)
TEST4_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/README.md","content":"// documents foo\n\nexport const foo = 1;"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
TEST4_ERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 4 (markdown out of scope)" 0 "$TEST4_EXIT"
assert_stderr_excludes "Test 4 stderr (no warning)" "WARN" "$TEST4_ERR"

# Test 5: test file is out of scope (*.test.*) → bypass
TEST5_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// documents foo\n\nexport const foo = 1;"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (test file out of scope)" 0 "$TEST5_EXIT"

# Test 6: non-Write/Edit tool bypasses
TEST6_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-Write/Edit tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: bypass env var honored on violating content → exit 0
TEST7_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// documents foo\n\nexport const foo = 1;"}}'
TEST7_EXIT=$(HOOK_BYPASS_COMMENT_ADJACENCY=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "comment-adjacency.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
