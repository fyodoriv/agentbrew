#!/bin/bash
# Test fixture for checks/gh-pr-body-no-review-response.sh

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-no-review-response.sh"
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

run_hook() {
  local input="$1"
  echo "$input" | bash "$SCRIPT" 2>/dev/null
  echo $?
}

# Test 1: Qodo review - resolved section → block (exit 2)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 2213 --body \"## Summary\\n\\n## Qodo review - resolved\\n| Comment | Fix |\""}}'
assert_exit_code "Test 1 (Qodo review - resolved)" 2 "$(run_hook "$TEST1_INPUT" | tail -1)"

# Test 2: Reviewer feedback addressed → block
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix\\n\\n## Reviewer feedback addressed\\n- done\""}}'
assert_exit_code "Test 2 (Reviewer feedback addressed)" 2 "$(run_hook "$TEST2_INPUT" | tail -1)"

# Test 3: clean artifact-focused body → allow
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \"## Summary\\nFix because ticket PROJ-123\""}}'
assert_exit_code "Test 3 (clean body)" 0 "$(run_hook "$TEST3_INPUT" | tail -1)"

# Test 4: not gh pr → bypass
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
assert_exit_code "Test 4 (not gh pr)" 0 "$(run_hook "$TEST4_INPUT" | tail -1)"

# Test 5: --body-file takes the early-allow branch (reason says so).
# A pattern like '--body-file' must not be parsed as a grep option, or the
# branch is skipped and the reason falls through to "no --body arg detected".
FIXTURE_HOME="$(mktemp -d)"
TEST5='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr edit 12 --body-file /tmp/body.md"}}'
echo "$TEST5" | HOME="$FIXTURE_HOME" bash "$SCRIPT" >/dev/null 2>&1
assert_exit_code "Test 5 (--body-file exit)" 0 "$?"
LOG_TEXT="$(cat "$FIXTURE_HOME/.cache/agentbrew/hook-decisions.jsonl" 2>/dev/null || true)"
if [[ "$LOG_TEXT" == *"--body-file used"* ]]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 5 (--body-file branch): reason missing '--body-file used', got: $LOG_TEXT")
fi
rm -rf "$FIXTURE_HOME"

# Command position: a command that only mentions `gh pr` in quoted text is
# not a PR command. A real one after `cd x &&` and an env prefix still is.
cp_exit() {
  local rc=0
  jq -nc --arg cmd "$1" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd}}' |
    bash "$SCRIPT" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}
cp_stderr() {
  jq -nc --arg cmd "$1" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd}}' |
    bash "$SCRIPT" 2>&1 >/dev/null || true
}
CP_ARGS='--body "## Summary\nFix\n\n## Reviewer feedback addressed\n- done"'
assert_exit_code "echoed gh pr mention passes" 0 "$(cp_exit "echo 'gh pr create $CP_ARGS'")"
assert_exit_code "python string gh pr mention passes" 0 "$(cp_exit "python3 -c \"s = 'gh pr create $CP_ARGS'\"")"
assert_exit_code "cd && GH_HOST=... gh pr create still blocks" 2 "$(cp_exit "cd x && GH_HOST=github.com gh pr create $CP_ARGS")"

# A heredoc body spans many lines; the shared parser still reads it.
CP_HEREDOC=$'gh pr create --title "x" --body "$(cat <<\'EOF\'\n## Summary\nFix\n\n## Reviewer feedback addressed\n- done\nEOF\n)"'
assert_exit_code "heredoc body with a review-response section blocks" 2 "$(cp_exit "$CP_HEREDOC")"

if [ "$FAIL" -eq 0 ]; then
  echo "gh-pr-body-no-review-response.sh: $PASS passed, $FAIL failed"
  exit 0
fi

echo "gh-pr-body-no-review-response.sh: $PASS passed, $FAIL failed"
for detail in "${FAIL_DETAILS[@]}"; do
  echo "  - $detail"
done
exit 1
