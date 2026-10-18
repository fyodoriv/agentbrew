#!/bin/bash
# Test fixture for checks/git-strip-agent-attribution.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code (+ stderr for the warn cases). Run:
# `bash git-strip-agent-attribution.test.sh` (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): this hook calls verdict_warn → exit 0
# (the dotfiles/git-hooks/commit-msg hook does the actual strip + footer
# append downstream; this hook only surfaces a warning). Every path
# exits 0; the violation cases additionally assert the warn message
# reached stderr, proving the verdict path genuinely fired.
#
# Note: the attribution regex anchors `^Co-Authored-By:` / `^Generated
# with` to the start of a line, so violation messages use a real `\n`
# (single backslash-n in the JSON) to place the trailer at line start.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/git-strip-agent-attribution.sh"
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

# Test 1: git commit -m with Co-Authored-By: Claude trailer → warn (exit 0 + stderr)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix the bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (Co-Authored-By: Claude) exit" 0 "$TEST1_EXIT"
TEST1_STDERR=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 1 (Co-Authored-By: Claude) warn fired" "foreign agent attribution" "$TEST1_STDERR"

# Test 2: git commit -m with a "Generated with [Claude Code](...)" footer → warn
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix it\n\nGenerated with [Claude Code](https://claude.com/claude-code)\""}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (Generated with [Claude Code]) exit" 0 "$TEST2_EXIT"
TEST2_STDERR=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 2 (Generated with [Claude Code]) warn fired" "foreign agent attribution" "$TEST2_STDERR"

# Test 3: Devin bot Co-Authored-By trailer → warn
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix\n\nCo-Authored-By: Devin <devin-ai-integration[bot]@users.noreply.github.com>\""}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (Co-Authored-By: Devin) exit" 0 "$TEST3_EXIT"
TEST3_STDERR=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
assert_stderr_contains "Test 3 (Co-Authored-By: Devin) warn fired" "foreign agent attribution" "$TEST3_STDERR"

# Test 4: clean commit message with no foreign attribution → allow, no warn
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix: handle empty array case\""}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (clean message) exit" 0 "$TEST4_EXIT"
TEST4_STDERR=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>&1 1>/dev/null)
if printf '%s' "$TEST4_STDERR" | grep -q "WARN"; then
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 4 (clean message): unexpectedly warned")
else
  PASS=$((PASS + 1))
fi

# Test 5: not a git commit (git status) → bypass
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (git status bypasses)" 0 "$TEST5_EXIT"

# Test 6: non-Bash tool → bypass
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.txt","content":"Co-Authored-By: Claude <noreply@anthropic.com>"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (non-Bash tool bypasses)" 0 "$TEST6_EXIT"

# Test 7: bypass env var honored even with attribution present → exit 0
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}'
TEST7_EXIT=$(HOOK_BYPASS_GIT_STRIP_AGENT_ATTRIBUTION=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Test 8: MINSKY_PIPELINE=1 bypass honored (orchestrator manages attribution) → exit 0
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\""}}'
TEST8_EXIT=$(MINSKY_PIPELINE=1 bash -c "echo '$TEST8_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (MINSKY_PIPELINE bypass allows)" 0 "$TEST8_EXIT"

# Tests 9-11: the shared strip library (hooks/lib/strip-agent-attribution.sh)
# keeps git trailers last. git reads trailers only from the last paragraph.
# `--no-divider` reads them the way `git log %(trailers)` does: without it,
# git treats the footer's `---` line as a patch divider.
LIB="$(dirname "$SCRIPT")/../lib/strip-agent-attribution.sh"
LIB_TMP=$(mktemp -d)
FOOTER_LINE='_🤖 Written by an agent, not Fyodor. Ping me if this looks off._'

run_lib_strip() {
  AGENT_FOOTER_NAME=Fyodor GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    bash -c '. "$1"; _strip_agent_attribution_in_file "$2" >/dev/null' _ "$LIB" "$1" </dev/null
}

assert_true() {
  local label="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label")
  fi
}

# Test 9: Task/Task-Claim trailers plus a stripped vendor Co-Authored-By line.
MSG9="$LIB_TMP/msg9"
printf 'fix: x\n\nBody text.\n\nTask: fix-the-thing\nTask-Claim: abc123\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$MSG9"
run_lib_strip "$MSG9"
TRAILERS9=$(git interpret-trailers --parse --no-divider < "$MSG9")
assert_true "Test 9 (Task trailer still parsed)" grep -qx 'Task: fix-the-thing' <<<"$TRAILERS9"
assert_true "Test 9 (Task-Claim trailer still parsed)" grep -qx 'Task-Claim: abc123' <<<"$TRAILERS9"
assert_true "Test 9 (footer present)" grep -qxF "$FOOTER_LINE" "$MSG9"
assert_true "Test 9 (vendor line stripped)" test "$(grep -c 'Co-Authored-By' "$MSG9")" = 0

# Test 10: no trailers left after the strip → footer stays at the end.
MSG10="$LIB_TMP/msg10"
printf 'fix: x\n\nBody text.\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$MSG10"
run_lib_strip "$MSG10"
assert_true "Test 10 (footer is the last line)" test "$(tail -1 "$MSG10")" = "$FOOTER_LINE"
assert_true "Test 10 (divider before footer)" test "$(tail -2 "$MSG10" | head -1)" = '---'

# Test 11: plain prose ending, nothing to strip → message unchanged.
MSG11="$LIB_TMP/msg11"
printf 'fix: x\n\nFixes the bug: it was slow.\n' > "$MSG11"
cp "$MSG11" "$MSG11.before"
run_lib_strip "$MSG11"
assert_true "Test 11 (plain prose unchanged)" cmp -s "$MSG11" "$MSG11.before"
rm -rf "$LIB_TMP"

# Report
echo ""
echo "git-strip-agent-attribution.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
