#!/bin/bash
# Test fixture for checks/pending-internal-work-needs-ticket.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code + stderr shape. Run:
# `bash pending-internal-work-needs-ticket.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# This is a WARN hook (verdict_warn → exit 0): a bare TODO/FIXME/HACK/XXX
# without a Jira-style ticket (PROJ-123) or owner (TODO(...) /
# TODO @name) warns. The meaningful signal is the "[hook ... WARN]" stderr
# line, so we assert exit 0 AND that stderr contains/excludes WARN.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/pending-internal-work-needs-ticket.sh"
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
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected stderr to contain '$needle'")
  fi
}

assert_stderr_excludes() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected stderr NOT to contain '$needle'")
  else
    PASS=$((PASS + 1))
  fi
}

# Test 1: no TODO/FIXME at all → allow (exit 0, no WARN)
TEST1_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"export const foo = 1;"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
TEST1_ERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 1 (no TODO)" 0 "$TEST1_EXIT"
assert_stderr_excludes "Test 1 stderr (no warning)" "WARN" "$TEST1_ERR"

# Test 2: TODO WITH a Jira ticket reference → allow
TEST2_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// TODO(PROJ-123): clean up after Phase 3\nexport const foo = 1;"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
TEST2_ERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 2 (TODO with ticket)" 0 "$TEST2_EXIT"
assert_stderr_excludes "Test 2 stderr (no warning)" "WARN" "$TEST2_ERR"

# Test 3: TODO WITH an owner reference (TODO @name) → allow
TEST3_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// TODO @alice: review with team\nexport const foo = 1;"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
TEST3_ERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 3 (TODO with owner)" 0 "$TEST3_EXIT"
assert_stderr_excludes "Test 3 stderr (no warning)" "WARN" "$TEST3_ERR"

# Test 4: bare TODO, no ticket/owner (Write) → warn (exit 0 + WARN)
TEST4_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// TODO: fix the foo later\nexport const foo = 1;"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
TEST4_ERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 4 (bare TODO Write → warn exits 0)" 0 "$TEST4_EXIT"
assert_stderr_contains "Test 4 stderr (warn path reached)" "WARN" "$TEST4_ERR"

# Test 5: bare FIXME in Edit new_string → warn
TEST5_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/src/bar.ts","old_string":"","new_string":"// FIXME: handle the empty case"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
TEST5_ERR=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 5 (bare FIXME Edit → warn exits 0)" 0 "$TEST5_EXIT"
assert_stderr_contains "Test 5 stderr (warn path reached)" "WARN" "$TEST5_ERR"

# Test 6: bare TODO in a test file (out of scope) → bypass
TEST6_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.test.ts","content":"// TODO: fix the foo later"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
TEST6_ERR=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>&1 >/dev/null)
assert_exit_code "Test 6 (test file out of scope)" 0 "$TEST6_EXIT"
assert_stderr_excludes "Test 6 stderr (no warning)" "WARN" "$TEST6_ERR"

# Test 7: non-Write/Edit tool bypasses
TEST7_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST7_EXIT=$(echo "$TEST7_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (non-Write/Edit tool bypasses)" 0 "$TEST7_EXIT"

# Test 8: bypass env var honored on violating content → exit 0
TEST8_INPUT='{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/foo.ts","content":"// TODO: fix the foo later"}}'
TEST8_EXIT=$(HOOK_BYPASS_PENDING_INTERNAL_WORK_NEEDS_TICKET=1 bash -c "echo '$TEST8_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (HOOK_BYPASS env var allows)" 0 "$TEST8_EXIT"

# Report
echo ""
echo "pending-internal-work-needs-ticket.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
