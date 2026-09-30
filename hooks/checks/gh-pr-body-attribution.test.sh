#!/bin/bash
# Test fixture for checks/gh-pr-body-attribution.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code (+ stderr for the warn cases). Run:
# `bash gh-pr-body-attribution.test.sh` (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): this hook calls verdict_warn → exit 0
# (the dotfiles/bin/gh wrapper does the actual strip downstream; this
# hook only surfaces a warning). Every path therefore exits 0; the
# violation cases additionally assert the warn message reached stderr,
# proving the verdict path genuinely fired.
#
# Note: the attribution regex anchors `^Co-Authored-By:` / `^Generated
# with` to the start of a line, so violation bodies use a real `\n`
# (single backslash-n in the JSON) to place the trailer at line start.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-attribution.sh"
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
  if printf '%s' "$haystack" | grep -q "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: stderr did not contain '$needle'")
  fi
}

# Test 1: body with Co-Authored-By: Claude trailer → warn (exit 0 + stderr)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix\" --body \"## Summary\nFix the thing because reasons\n\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (Co-Authored-By: Claude) exit" 0 "$TEST1_EXIT"
TEST1_STDERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 1 (Co-Authored-By: Claude) warn fired" "foreign agent attribution" "$TEST1_STDERR"

# Test 2: body with a "Generated with [Claude Code](...)" footer → warn
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\nFixes it\n\nGenerated with [Claude Code](https://claude.com/claude-code)\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (Generated with [Claude Code]) exit" 0 "$TEST2_EXIT"
TEST2_STDERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 2 (Generated with [Claude Code]) warn fired" "foreign agent attribution" "$TEST2_STDERR"

# Test 3: Devin bot Co-Authored-By trailer → warn
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 7 --body \"fix\n\nCo-Authored-By: Devin <devin-ai-integration[bot]@users.noreply.github.com>\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (Co-Authored-By: Devin) exit" 0 "$TEST3_EXIT"
TEST3_STDERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 3 (Co-Authored-By: Devin) warn fired" "foreign agent attribution" "$TEST3_STDERR"

# Test 4: clean body with no foreign attribution → allow, no warn
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix\" --body \"## Summary\nFix the thing because the bar broke\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (clean body) exit" 0 "$TEST4_EXIT"
TEST4_STDERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
if printf '%s' "$TEST4_STDERR" | grep -q "WARN"; then
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 4 (clean body): unexpectedly warned")
else
  PASS=$((PASS + 1))
fi

# Test 5: not a gh pr/issue body command (gh pr view) → bypass
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 5"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (gh pr view bypasses)" 0 "$TEST5_EXIT"

# Test 6: non-Bash tool → bypass
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.md","content":"Co-Authored-By: Claude <noreply@anthropic.com>"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-Bash tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: bypass env var honored even with attribution present → exit 0
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}'
TEST7_EXIT=$(HOOK_BYPASS_GH_PR_BODY_ATTRIBUTION=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "gh-pr-body-attribution.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
