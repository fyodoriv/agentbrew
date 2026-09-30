#!/bin/bash
# Test fixture for checks/jira-no-grandchildren.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash jira-no-grandchildren.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# The hook fires on the jira create-issue MCP tool names
# (mcp__jira-mcp__create_issue|create_subtask, mcp__atlassian__createJiraIssue|
# createSubtask) and blocks (exit 2) when issueType is a Sub-task AND a
# parent is specified (would create an Epic → Story → Sub-task grandchild).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/jira-no-grandchildren.sh"
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

# Test 1: Create a Story with parent Epic → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__jira-mcp__create_issue","tool_input":{"issueType":"Story","parent":"PROJ-100","summary":"Build the thing"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (Story under Epic)" 0 "$TEST1_EXIT"

# Test 2: Create a Sub-task with a parent → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__jira-mcp__create_subtask","tool_input":{"issueType":"Sub-task","parentKey":"PROJ-200","summary":"A grandchild"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (Sub-task with parent)" 2 "$TEST2_EXIT"

# Test 3: Atlassian variant, type=subtask + parent → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__atlassian__createSubtask","tool_input":{"type":"subtask","parent":"PROJ-9"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (atlassian subtask with parent)" 2 "$TEST3_EXIT"

# Test 4: Sub-task with NO parent → bypass (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__jira-mcp__create_subtask","tool_input":{"issueType":"Sub-task","summary":"orphan"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (Sub-task with no parent bypasses)" 0 "$TEST4_EXIT"

# Test 5: Non-matching tool (Bash) → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-jira tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: A different (non create-issue) jira MCP tool → bypass (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__jira-mcp__get_issue","tool_input":{"issueType":"Sub-task","parent":"PROJ-200"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (jira get_issue tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: Bypass env var honored on a violating input → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"mcp__jira-mcp__create_subtask","tool_input":{"issueType":"Sub-task","parentKey":"PROJ-200"}}'
TEST7_EXIT=$(HOOK_BYPASS_JIRA_NO_GRANDCHILDREN=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "jira-no-grandchildren.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
