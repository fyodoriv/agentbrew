#!/bin/bash
# Test fixture for checks/env-correct-urls.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code (+ stderr for the warn cases). Run:
# `bash env-correct-urls.test.sh` (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): warn → exit 0 (stderr message), allow /
# bypass → exit 0. This is a WARN hook, so every path exits 0; the
# violation cases additionally assert that the warn message reached
# stderr, proving the verdict path genuinely fired.
#
# The hook fires on `gh pr/issue create/edit`, reads the env keyword in
# --title, and warns when the body links a URL for a different env.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/env-correct-urls.sh"
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

# Test 1: title mentions staging but body links a PROD URL → warn (exit 0 + stderr)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"staging rollback verification\" --body \"verify at https://app.example.com/foo\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (staging title + PROD url) exit" 0 "$TEST1_EXIT"
TEST1_STDERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 1 (staging title + PROD url) warn fired" "Env-Correct URLs" "$TEST1_STDERR"

# Test 2: title mentions PROD but body links a staging URL → warn
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"PROD deploy\" --body \"verify at https://staging.app.example.com/bar\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (PROD title + staging url) exit" 0 "$TEST2_EXIT"
TEST2_STDERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 2 (PROD title + staging url) warn fired" "Env-Correct URLs" "$TEST2_STDERR"

# Test 3: title + body env match (staging title + staging url) → allow, no warn
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"staging rollback verification\" --body \"verify at https://staging.app.example.com/foo\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (staging title + staging url) exit" 0 "$TEST3_EXIT"
TEST3_STDERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
if printf '%s' "$TEST3_STDERR" | grep -q "WARN"; then
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 3 (staging title + staging url): unexpectedly warned")
else
  PASS=$((PASS + 1))
fi

# Test 4: no env keyword in title → bypass
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix the foo\" --body \"see https://app.example.com/x\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (no env keyword bypasses)" 0 "$TEST4_EXIT"

# Test 5: non-Bash tool → bypass
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.md","content":"staging https://app.example.com/foo"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-Bash tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: bypass env var honored even on a mismatched input → exit 0
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"staging rollback\" --body \"verify at https://app.example.com/foo\""}}'
TEST6_EXIT=$(HOOK_BYPASS_ENV_CORRECT_URLS=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var allows)" 0 "$TEST6_EXIT"

# Report
echo ""
echo "env-correct-urls.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
