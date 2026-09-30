#!/bin/bash
# Test fixture for checks/no-binary-screenshots.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash no-binary-screenshots.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Hook contract (from no-binary-screenshots.sh header): PreToolUse on
# Bash, verdict BLOCK (exit 2) when `git add` stages a
# png/jpg/jpeg/gif/webp/bmp file outside the exempt locations
# (__storyshots__/, favicon, fixtures/, snapshots/). SVG and non-image
# files are allowed. Bypass var: HOOK_BYPASS_NO_BINARY_SCREENSHOTS=1.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-binary-screenshots.sh"
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

# Test 1: clean `git add <source-file>` (no image) → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add src/index.ts"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean git add source file)" 0 "$TEST1_EXIT"

# Test 2: violating `git add screenshots/dashboard.png` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add screenshots/dashboard.png"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (git add .png blocks)" 2 "$TEST2_EXIT"

# Test 3: non-Bash tool (Write) → hook bypasses (exit 0)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.sh","content":"git add screenshots/dashboard.png"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (non-Bash tool bypasses)" 0 "$TEST3_EXIT"

# Test 4: non git-add Bash command → hook bypasses (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello.png"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (non git-add bypasses)" 0 "$TEST4_EXIT"

# Test 5: bypass env var set with otherwise-violating command → allow (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add foo.png"}}'
TEST5_EXIT=$(HOOK_BYPASS_NO_BINARY_SCREENSHOTS=1 bash -c "echo '$TEST5_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (HOOK_BYPASS env var allows)" 0 "$TEST5_EXIT"

# Test 6: documented exemption — png under __storyshots__ → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add src/components/__storyshots__/button.png"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (__storyshots__ png allowed)" 0 "$TEST6_EXIT"

# Test 7: documented exemption — SVG is text, not a binary screenshot → allow
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add docs/architecture.svg"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (svg allowed)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "no-binary-screenshots.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
