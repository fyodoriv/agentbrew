#!/bin/bash
# Test fixture for checks/no-commit-no-verify.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash no-commit-no-verify.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Hook contract (from no-commit-no-verify.sh header): PreToolUse on Bash,
# verdict BLOCK (exit 2) on `git commit --no-verify` / `git commit -n`.
# Bypass: NONE — the script intentionally checks no HOOK_BYPASS var, so
# Test 6 asserts the env var is IGNORED (still blocks), matching the
# header's documented "Bypass: NONE. This is one of the few hooks with no
# bypass — the rule is iron."

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-commit-no-verify.sh"
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

# Test 1: clean `git commit -m "..."` (verify hooks run) → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: add foo\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean git commit -m)" 0 "$TEST1_EXIT"

# Test 2: violating `git commit --no-verify -m "..."` → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m \"feat: add foo\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (git commit --no-verify blocks)" 2 "$TEST2_EXIT"

# Test 3: violating short form `git commit -n -m msg` → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -n -m msg"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (git commit -n blocks)" 2 "$TEST3_EXIT"

# Test 4: non-Bash tool (Write) → hook bypasses (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.sh","content":"git commit --no-verify"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (non-Bash tool bypasses)" 0 "$TEST4_EXIT"

# Test 5: clean — `git commit` without -n/--no-verify is unaffected (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix: a bug\""}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (plain commit unaffected)" 0 "$TEST5_EXIT"

# Test 6: bypass env var is IGNORED — this hook has NO bypass (header: "Bypass:
# NONE"). Setting HOOK_BYPASS_NO_COMMIT_NO_VERIFY=1 must STILL block (exit 2).
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m msg"}}'
TEST6_EXIT=$(HOOK_BYPASS_NO_COMMIT_NO_VERIFY=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (no bypass exists; env ignored, still blocks)" 2 "$TEST6_EXIT"

# Report
echo ""
echo "no-commit-no-verify.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
