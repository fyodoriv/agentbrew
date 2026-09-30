#!/bin/bash
# Test fixture for checks/gh-pr-body-requires-rationale.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash gh-pr-body-requires-rationale.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): block → exit 2, allow/bypass → exit 0.
# The hook fires on `gh pr create` / `gh pr edit`, extracts the --body
# arg, and blocks only when the body has NO section header, NO rationale
# word, and NO ticket reference.
#
# JSON note: bodies are single-quoted; inner double-quotes are \". A
# literal `\n` inside the body is written `\\n` so jq keeps the body on
# one physical line (the hook extracts --body with a single-line sed).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-requires-rationale.sh"
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

# Test 1: gh pr create with a "## Summary" header + "because" → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix the foo\" --body \"## Summary\\nFix the foo because the bar broke\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (## Summary + because)" 0 "$TEST1_EXIT"

# Test 2: gh pr create with a ticket reference only → allow
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"PROJ-123 handle the empty array case\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (ticket ref only)" 0 "$TEST2_EXIT"

# Test 3: gh pr edit with "## Why" header + "addresses" → allow
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 42 --body \"## Why\\nthis addresses the flaky retry path\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (gh pr edit, ## Why + addresses)" 0 "$TEST3_EXIT"

# Test 4: gh pr create with a body that has no rationale signal → block (exit 2)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"ship it\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (no rationale signal)" 2 "$TEST4_EXIT"

# Test 5: "fixed the bug" is not the rationale word "fixes" → block
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"fixed the bug\""}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (fixed != fixes)" 2 "$TEST5_EXIT"

# Test 6: --body-file is trusted (the file is assumed to have structure) → bypass
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body-file /tmp/pr-body.md"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (--body-file bypasses)" 0 "$TEST6_EXIT"

# Test 7: not gh pr create/edit (gh pr view) → bypass
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 123"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (gh pr view bypasses)" 0 "$TEST7_EXIT"

# Test 8: non-Bash tool → bypass
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"ship it"}}'
TEST8_EXIT=$(echo "$TEST8_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (non-Bash tool bypasses)" 0 "$TEST8_EXIT"

# Test 9: bypass env var honored even on a violating body → exit 0
TEST9_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"ship it\""}}'
TEST9_EXIT=$(HOOK_BYPASS_GH_PR_BODY_REQUIRES_RATIONALE=1 bash -c "echo '$TEST9_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST9_EXIT=$(echo "$TEST9_EXIT" | tail -1)
assert_exit_code "Test 9 (HOOK_BYPASS env var allows)" 0 "$TEST9_EXIT"

# Report
echo ""
echo "gh-pr-body-requires-rationale.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
