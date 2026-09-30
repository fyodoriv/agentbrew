#!/bin/bash
# Test fixture for checks/no-git-add-all.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash no-git-add-all.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Hook contract (from no-git-add-all.sh header): PreToolUse on Bash,
# verdict BLOCK (exit 2) on `git add -A|.|--all|-u|--update`. Bypass var:
# HOOK_BYPASS_NO_GIT_ADD_ALL=1. `git add <specific-file>` and `git add -p`
# are allowed.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-git-add-all.sh"
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

# Test 1: clean Bash `git add <specific-file>` → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add specific-file.ts"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean git add specific-file)" 0 "$TEST1_EXIT"

# Test 2: violating `git add -A` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add -A"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (git add -A blocks)" 2 "$TEST2_EXIT"

# Test 3: violating `git add .` → block (exit 2) — exercises the \.$ branch
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add ."}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (git add . blocks)" 2 "$TEST3_EXIT"

# Test 4: violating `git add --all` → block (exit 2)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add --all"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (git add --all blocks)" 2 "$TEST4_EXIT"

# Test 5: non-Bash tool (Write) → hook bypasses (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"git add -A"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-Bash tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: bypass env var set with otherwise-violating command → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add -A"}}'
TEST6_EXIT=$(HOOK_BYPASS_NO_GIT_ADD_ALL=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var allows)" 0 "$TEST6_EXIT"

# Test 7: documented exemption — `git add -p` (interactive patch) → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git add -p"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (git add -p allowed)" 0 "$TEST7_EXIT"

# Report
echo ""
echo "no-git-add-all.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
