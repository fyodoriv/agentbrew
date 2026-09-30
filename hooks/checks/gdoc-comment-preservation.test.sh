#!/bin/bash
# Test fixture for checks/gdoc-comment-preservation.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash gdoc-comment-preservation.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# The hook fires on google-drive MCP tools (mcp__company-google-drive-mcp__*,
# mcp__google-drive-mcp__*, mcp__drive__*) and blocks (exit 2) any tool whose
# name resolves/deletes/updates a comment (*resolveComment*, *deleteComment*,
# *updateComment*, *removeReply*). batchUpdate/replaceText with delete ops only
# warns (exit 0); insert-only / read-only calls are allowed (exit 0).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gdoc-comment-preservation.sh"
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

# Test 1: Insert-only google-drive edit → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__insertText","tool_input":{"text":"hello","index":1}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (insertText allowed)" 0 "$TEST1_EXIT"

# Test 2: resolveComment → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__resolveComment","tool_input":{"commentId":"c1"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (resolveComment blocked)" 2 "$TEST2_EXIT"

# Test 3: deleteCommentReply (organization variant) → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__company-google-drive-mcp__deleteCommentReply","tool_input":{"commentId":"c1","replyId":"r1"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (deleteCommentReply blocked)" 2 "$TEST3_EXIT"

# Test 4: batchUpdate with deleteRange op → warn, not block (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__batchUpdate","tool_input":{"requests":"[{deleteRange:{range:{startIndex:1,endIndex:9}}}]"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (batchUpdate deleteRange warns, exit 0)" 0 "$TEST4_EXIT"

# Test 5: Non-matching tool (Bash) → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-google-drive tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: Read-only google-drive tool → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__getDoc","tool_input":{"docId":"d1"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (read-only getDoc allowed)" 0 "$TEST6_EXIT"

# Test 7: Bypass env var honored on a violating input → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__google-drive-mcp__resolveComment","tool_input":{"commentId":"c1"}}'
TEST7_EXIT=$(HOOK_BYPASS_GDOC_COMMENT_PRESERVATION=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "gdoc-comment-preservation.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
