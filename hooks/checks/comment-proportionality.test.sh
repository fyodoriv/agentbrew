#!/bin/bash
# Test fixture for checks/comment-proportionality.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run: `bash comment-proportionality.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# comment-proportionality is a WARN hook (verdict_warn → exit 0); the
# meaningful signal is the "[hook ... WARN]" stderr line. It only fires on
# Write (not Edit), only on files with >= MIN_FILE_LINES (20) nonblank
# lines, and warns when comment lines exceed MAX_COMMENT_RATIO_PCT (50%).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/comment-proportionality.sh"
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

# Reusable fixtures.
# Comment-heavy: 14 comment lines + 6 code lines = 20 nonblank, ratio 70% (> 50%, >= 20 lines).
HEAVY='// c1\n// c2\n// c3\n// c4\n// c5\n// c6\n// c7\n// c8\n// c9\n// c10\n// c11\n// c12\n// c13\n// c14\nconst v1 = 1;\nconst v2 = 2;\nconst v3 = 3;\nconst v4 = 4;\nconst v5 = 5;\nconst v6 = 6;'
# Code-heavy: 4 comment lines + 16 code lines = 20 nonblank, ratio 20% (clears size gate, under threshold).
LIGHT='// c1\n// c2\n// c3\n// c4\nconst v1 = 1;\nconst v2 = 2;\nconst v3 = 3;\nconst v4 = 4;\nconst v5 = 5;\nconst v6 = 6;\nconst v7 = 7;\nconst v8 = 8;\nconst v9 = 9;\nconst v10 = 10;\nconst v11 = 11;\nconst v12 = 12;\nconst v13 = 13;\nconst v14 = 14;\nconst v15 = 15;\nconst v16 = 16;'
# Tiny: 5 comment + 2 code = 7 nonblank (< MIN_FILE_LINES), comment-heavy but too small to judge.
TINY='// a\n// b\n// c\n// d\n// e\nconst x = 1;\nconst y = 2;'

# Test 1: code-heavy file, large enough to judge → allow (exit 0, no WARN)
TEST1_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/repo/src/big.ts\",\"content\":\"$LIGHT\"}}"
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
TEST1_ERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 1 (code-heavy file under threshold)" 0 "$TEST1_EXIT"
assert_stderr_excludes "Test 1 stderr (no warning)" "WARN" "$TEST1_ERR"

# Test 2: comment-heavy Write (70% comments) → warn (exit 0 + WARN)
TEST2_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/repo/src/big.ts\",\"content\":\"$HEAVY\"}}"
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (over-commented Write → warn exits 0)" 0 "$TEST2_EXIT"
assert_stderr_contains "Test 2 stderr (warn path reached)" "WARN" "$TEST2_ERR"

# Test 3: Edit tool with comment-heavy new_string → bypass (hook is Write-only)
TEST3_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"/repo/src/big.ts\",\"new_string\":\"$HEAVY\"}}"
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
TEST3_ERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 3 (Edit tool is not Write → bypass)" 0 "$TEST3_EXIT"
assert_stderr_excludes "Test 3 stderr (no warning)" "WARN" "$TEST3_ERR"

# Test 4: comment-heavy but file too small (< 20 nonblank) → bypass
TEST4_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/repo/src/small.ts\",\"content\":\"$TINY\"}}"
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
TEST4_ERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 4 (file too small → bypass)" 0 "$TEST4_EXIT"
assert_stderr_excludes "Test 4 stderr (no warning)" "WARN" "$TEST4_ERR"

# Test 5: comment-heavy but markdown (out of scope) → bypass
TEST5_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/repo/notes.md\",\"content\":\"$HEAVY\"}}"
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (markdown out of scope)" 0 "$TEST5_EXIT"

# Test 6: bypass env var honored on violating content → exit 0
TEST6_INPUT="{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"/repo/src/big.ts\",\"content\":\"$HEAVY\"}}"
TEST6_EXIT=$(HOOK_BYPASS_COMMENT_PROPORTIONALITY=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var allows)" 0 "$TEST6_EXIT"

# Report
echo ""
echo "comment-proportionality.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
