#!/bin/bash
# Test fixture for checks/gdoc-surgical-edit-only.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash gdoc-surgical-edit-only.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# The hook fires on google-drive MCP write/update tools and blocks (exit 2)
# wholesale-replace edits: replaceMode/mode of full|replace, or a >8KB
# tool_input that carries a `body` field. Surgical edits (small localized
# batchUpdate/replaceText) and non-write tools are allowed (exit 0).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gdoc-surgical-edit-only.sh"
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

# Test 1: Small surgical batchUpdate (localized replaceText) → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__batchUpdate","tool_input":{"requests":[{"replaceText":{"containsText":"typo","replaceWith":"fixed"}}]}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (small surgical edit allowed)" 0 "$TEST1_EXIT"

# Test 2: update_doc with mode=full → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__update_doc","tool_input":{"mode":"full","body":"the whole document text"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (mode=full blocked)" 2 "$TEST2_EXIT"

# Test 3: update_doc with replaceMode=replace → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__update_doc","tool_input":{"replaceMode":"replace","body":"x"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (replaceMode=replace blocked)" 2 "$TEST3_EXIT"

# Test 4: Huge payload (>8KB) carrying a body field → block (exit 2)
BIG_BODY=$(printf 'a%.0s' $(seq 1 9000))
TEST4_INPUT=$(jq -nc --arg b "$BIG_BODY" '{hook_event_name:"PreToolUse",tool_name:"mcp__google-drive-mcp__update_doc",tool_input:{body:$b}}')
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (huge body payload blocked)" 2 "$TEST4_EXIT"

# Test 5: Read-only google-drive tool (not a write op) → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__get_doc","tool_input":{"docId":"d1"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (read-only get_doc bypasses)" 0 "$TEST5_EXIT"

# Test 6: Non-matching tool (Bash) → bypass (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-google-drive tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: Bypass env var honored on a violating input → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__update_doc","tool_input":{"mode":"full","body":"the whole document text"}}'
TEST7_EXIT=$(HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "gdoc-surgical-edit-only.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
