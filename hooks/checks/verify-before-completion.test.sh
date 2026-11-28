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
BASH_TEST='{"message":{"content":[{"type":"tool_use","name":"Bash","id":"test","input":{"command":"npm test"}}]}}'
BASH_OK='{"message":{"content":[{"type":"tool_result","tool_use_id":"test","is_error":false,"content":"All checks passed"}]}}'
BASH_ECHO='{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo hello"}}]}}'

CODE_NO_VERIFY="$TMP/code-no-verify.jsonl"; printf '%s\n' "$EDIT_TS" "$BASH_ECHO" > "$CODE_NO_VERIFY"
CODE_WITH_VERIFY="$TMP/code-with-verify.jsonl"; printf '%s\n' "$EDIT_TS" "$BASH_TEST" "$BASH_OK" > "$CODE_WITH_VERIFY"
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

check_result() {
  local label="$1" expected="$2" command="$3" result_id="${4:-}" error="${5:-false}" output="${6:-All checks passed}"
  local transcript="$TMP/result.jsonl" call input
  call="$(jq -cn --arg cmd "$command" '{message:{content:[{type:"tool_use",name:"Bash",id:"test",input:{command:$cmd}}]}}')"
  printf '%s\n' "$EDIT_TS" "$call" > "$transcript"
  if [ -n "$result_id" ]; then
    jq -cn --arg id "$result_id" --argjson error "$error" --arg output "$output" \
      '{message:{content:[{type:"tool_result",tool_use_id:$id,is_error:$error,content:$output}]}}' >> "$transcript"
  fi
  input="$(jq -cn --arg transcript "$transcript" '{hook_event_name:"Stop",transcript_path:$transcript}')"
  assert_exit_code "$label" "$expected" "$(run_hook "$input")"
}

check_result "a refused test gives no verification" 2 "npx vitest run" test true "PreToolUse hook refused the command"
check_result "a test with no result gives no verification" 2 "npx vitest run"
check_result "a result for another call gives no verification" 2 "npx vitest run" other
check_result "a printed command gives no verification" 2 "echo 'npm test'" test
check_result "a command that suppresses its exit status gives no verification" 2 "npm test || true" test
check_result "printing gate help gives no verification" 2 "npm test --help" test
check_result "a dry run gives no verification" 2 "make check --dry-run" test
check_result "a completed queued make check gives verification" 0 "heavy-run make check" test
check_result "a timeout inside the queue still gives verification" 0 "heavy-run timeout 180 npm test" test
check_result "a completed repository check script gives verification" 0 "scripts/check.sh" test
check_result "a blocking hosted check gives verification" 0 "gh run watch 123 --exit-status" test false "Run CI (123) has already completed with 'success'"
check_result "a hosted check must propagate failure" 2 "gh run watch 123" test false "Run CI (123) completed with 'success'"
check_result "the fail-fast watcher gives hosted verification" 0 "bash ~/.claude/codeassist/hooks-scripts/lib/ci-watch-fail-fast.sh --repo o/r 46110246456" test false "Run CI (46110246456) completed with 'success'"
check_result "a failed fail-fast watch gives no verification" 2 "bash hooks/lib/ci-watch-fail-fast.sh 46110246456" test true "FAILED: verify (ubuntu-latest)"
check_result "a fail-fast watch of another run gives no verification" 2 "bash hooks/lib/ci-watch-fail-fast.sh 46110246456" test false "Run CI (46110246457) completed with 'success'"
check_result "a PR fail-fast watch is not a run proof" 2 "bash hooks/lib/ci-watch-fail-fast.sh 1373" test false "All 2 checks on PR 1373 passed."
check_result "a hosted error gives no verification" 2 "gh run watch 123 --exit-status" test false "error connecting to github.com"
check_result "a hosted result must match the explicit run ID" 2 "gh run watch 123 --exit-status" test false "Run CI (321) completed with 'success'"
check_result "a hosted check needs a run ID" 2 "gh run watch --repo example/repo --exit-status" test false "Run CI (123) completed with 'success'"
check_result "a hosted check rejects disabled exit status" 2 "gh run watch 123 --exit-status --exit-status=false" test false "Run CI (123) completed with 'success'"

CHECK_TRANSCRIPT="$TMP/check-sequence.jsonl"
CHECK_INPUT="{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$CHECK_TRANSCRIPT\"}"
USER_TEXT='{"type":"user","message":{"content":"Make another change."}}'
BASH_FAILED="${BASH_OK/false/true}"
printf '%s\n' "$BASH_TEST" "$BASH_OK" "$USER_TEXT" "$EDIT_TS" > "$CHECK_TRANSCRIPT"
assert_exit_code "an earlier turn gives no verification" 2 "$(run_hook "$CHECK_INPUT")"
printf '%s\n' "$EDIT_TS" "$BASH_TEST" "$BASH_OK" "$EDIT_TS" > "$CHECK_TRANSCRIPT"
assert_exit_code "a result before the last edit gives no verification" 2 "$(run_hook "$CHECK_INPUT")"
printf '%s\n' "$EDIT_TS" "$BASH_TEST" "$BASH_FAILED" "$BASH_TEST" "$BASH_OK" > "$CHECK_TRANSCRIPT"
assert_exit_code "a replay cannot replace a refusal" 2 "$(run_hook "$CHECK_INPUT")"
printf '%s\n' "$EDIT_TS" "$BASH_TEST" "$BASH_OK" "$BASH_FAILED" > "$CHECK_TRANSCRIPT"
assert_exit_code "conflicting results give no verification" 2 "$(run_hook "$CHECK_INPUT")"

echo ""
echo "verify-before-completion.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
