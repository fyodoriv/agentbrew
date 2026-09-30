#!/bin/bash
# Test fixture for checks/verify-before-completion.sh
#
# Stop-event hook: blocks when the turn edited code files but ran no verify
# command. Reads the transcript JSONL at .transcript_path, so each test
# builds a temp transcript and points the input at it.
# Run: `bash verify-before-completion.test.sh`

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/verify-before-completion.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
FAIL_DETAILS=()

assert_exit_code() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $actual")
  fi
}

run_hook() { # $1 = input json, rest = env assignments via caller
  local input="$1"
  local rc
  rc=$(printf '%s' "$input" | bash "$SCRIPT" >/dev/null 2>&1; echo $?)
  printf '%s' "$rc" | tail -1
}

# Build transcript fixtures (JSONL — one tool_use event per line)
EDIT_TS='{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/foo.ts","old_string":"a","new_string":"b"}}]}}'
BASH_TEST='{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}'
BASH_ECHO='{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo hello"}}]}}'

CODE_NO_VERIFY="$TMP/code-no-verify.jsonl"; printf '%s\n' "$EDIT_TS" "$BASH_ECHO" > "$CODE_NO_VERIFY"
CODE_WITH_VERIFY="$TMP/code-with-verify.jsonl"; printf '%s\n' "$EDIT_TS" "$BASH_TEST" > "$CODE_WITH_VERIFY"
NO_CODE="$TMP/no-code.jsonl"; printf '%s\n' "$BASH_ECHO" > "$NO_CODE"

# Test 1: code edits + NO verify command → block (exit 2)
T1=$(run_hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$CODE_NO_VERIFY\"}")
assert_exit_code "Test 1 (code edit, no verify → block)" 2 "$T1"

# Test 2: code edits + a verify command (npm test) → allow (exit 0)
T2=$(run_hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$CODE_WITH_VERIFY\"}")
assert_exit_code "Test 2 (code edit + npm test → allow)" 0 "$T2"

# Test 3: no code edits this turn → bypass (exit 0)
T3=$(run_hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$NO_CODE\"}")
assert_exit_code "Test 3 (no code edits → bypass)" 0 "$T3"

# Test 4: not a Stop event → bypass (exit 0)
T4=$(run_hook "{\"hook_event_name\":\"PreToolUse\",\"transcript_path\":\"$CODE_NO_VERIFY\"}")
assert_exit_code "Test 4 (non-Stop event → bypass)" 0 "$T4"

# Test 5: no transcript path → bypass (exit 0)
T5=$(run_hook '{"hook_event_name":"Stop"}')
assert_exit_code "Test 5 (no transcript → bypass)" 0 "$T5"

# Test 6: transcript path that does not exist → bypass (exit 0)
T6=$(run_hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$TMP/does-not-exist.jsonl\"}")
assert_exit_code "Test 6 (missing transcript file → bypass)" 0 "$T6"

# Test 7: HOOK_BYPASS env var set with a would-block transcript → allow
T7=$(HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1 bash -c "printf '%s' '{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$CODE_NO_VERIFY\"}' | bash '$SCRIPT' >/dev/null 2>&1; echo \$?" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env → allow)" 0 "$T7"

# Test 8: MINSKY_PIPELINE set with a would-block transcript → bypass (allow)
T8=$(MINSKY_PIPELINE=1 bash -c "printf '%s' '{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$CODE_NO_VERIFY\"}' | bash '$SCRIPT' >/dev/null 2>&1; echo \$?" | tail -1)
assert_exit_code "Test 8 (MINSKY_PIPELINE → bypass)" 0 "$T8"

echo ""
echo "verify-before-completion.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
