#!/bin/bash
# Test fixture for checks/git-commit-conventional.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash git-commit-conventional.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# Hook contract (from git-commit-conventional.sh header): PreToolUse on
# Bash, verdict BLOCK (exit 2) when a `git commit -m "..."` header is not
# Conventional Commits (`type: subject` / `type(scope): subject`) or
# exceeds 72 chars. amend/fixup and Merge/Revert subjects are exempt.
# Bypass var: HOOK_BYPASS_GIT_COMMIT_CONVENTIONAL=1.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/git-commit-conventional.sh"
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

# Test 1: clean conventional commit → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: add foo PROJ-1\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean conventional commit)" 0 "$TEST1_EXIT"

# Test 2: violating — no type prefix → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"added the foo\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (no type prefix blocks)" 2 "$TEST2_EXIT"

# Test 3: violating — capitalized type → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"Feat: added foo\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (capitalized type blocks)" 2 "$TEST3_EXIT"

# Test 4: violating — valid type but header > 72 chars → block (exit 2)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: this commit message header is intentionally far longer than seventy-two characters total\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (header > 72 chars blocks)" 2 "$TEST4_EXIT"

# Test 5: non-Bash tool (Write) → hook bypasses (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.sh","content":"git commit -m bad"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-Bash tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: bypass env var set with otherwise-violating command → allow (exit 0)
# (no inner quotes so the bash -c wrapper stays simple)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m added-the-foo"}}'
TEST6_EXIT=$(HOOK_BYPASS_GIT_COMMIT_CONVENTIONAL=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var allows)" 0 "$TEST6_EXIT"

# Test 7: documented exemption — amend uses existing message → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit --amend -m \"whatever non conventional\""}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (amend exempt)" 0 "$TEST7_EXIT"

# Test 8: documented exemption — git-builtin Merge subject → allow (exit 0)
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"Merge branch feature\""}}'
TEST8_EXIT=$(echo "$TEST8_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (Merge subject exempt)" 0 "$TEST8_EXIT"

# Test 9: clean conventional commit with scope → allow (exit 0)
TEST9_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix(parser): handle edge PROJ-2\""}}'
TEST9_EXIT=$(echo "$TEST9_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST9_EXIT=$(echo "$TEST9_EXIT" | tail -1)
assert_exit_code "Test 9 (scoped conventional commit)" 0 "$TEST9_EXIT"

# Report
echo ""
echo "git-commit-conventional.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
