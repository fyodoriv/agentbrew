#!/bin/bash
# Test fixture for checks/async-human-comms-blocks.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash async-human-comms-blocks.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# IMPORTANT: this hook does NOT read a path from the JSON. It locates
# ask_human.md by walking UP from the *current working directory* (`pwd`)
# up to 5 levels. So each fixture is run inside a temp dir we control
# (via `cd` in a command-substitution subshell, which does not leak to
# the test process). It blocks (exit 2) every non-read tool when an
# ask_human.md with `status: PENDING` is found; otherwise allows (exit 0).

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/async-human-comms-blocks.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()
TMP_DIRS=()

cleanup() {
  local tmp
  for tmp in "${TMP_DIRS[@]:-}"; do
    [ -n "$tmp" ] && rm -rf "$tmp"
  done
}
trap cleanup EXIT

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

# Build an isolated tree. ask_human.md only ever lives under pending/ and
# resolved/ — never in clean/ or any ancestor of clean/work, so the
# walk-up from clean/work genuinely finds nothing.
ROOT="$(mktemp -d)"
TMP_DIRS+=("$ROOT")
CLEAN_DIR="$ROOT/clean/work"
PENDING_DIR="$ROOT/pending"
RESOLVED_DIR="$ROOT/resolved"
mkdir -p "$CLEAN_DIR" "$PENDING_DIR" "$RESOLVED_DIR"
printf -- '---\nstatus: PENDING\nquestion: Should I deploy?\n---\n' >"$PENDING_DIR/ask_human.md"
printf -- '---\nstatus: RESOLVED\nanswer: yes\n---\n' >"$RESOLVED_DIR/ask_human.md"
mkdir -p "$ROOT/no-status"
printf -- '# Ask-Human Q&A Log\n\nNo YAML frontmatter here.\n' >"$ROOT/no-status/ask_human.md"

# Test 1: No ask_human.md in cwd or ancestors + mutating Bash → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
TEST1_EXIT=$(cd "$CLEAN_DIR" && echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (no ask_human.md allows)" 0 "$TEST1_EXIT"

# Test 2: PENDING ask_human.md + mutating Bash → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push"}}'
TEST2_EXIT=$(cd "$PENDING_DIR" && echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (PENDING blocks Bash)" 2 "$TEST2_EXIT"

# Test 3: PENDING + a Write to a normal (non-ask_human) file → block (exit 2)
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/proj/main.ts","content":"export const x = 1;"}}'
TEST3_EXIT=$(cd "$PENDING_DIR" && echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (PENDING blocks Write to other file)" 2 "$TEST3_EXIT"

# Test 4: RESOLVED ask_human.md + mutating Bash → allow (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push"}}'
TEST4_EXIT=$(cd "$RESOLVED_DIR" && echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (RESOLVED status allows)" 0 "$TEST4_EXIT"

# Test 5: Read-only tool (Read), even with PENDING present → allow (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"/tmp/proj/main.ts"}}'
TEST5_EXIT=$(cd "$PENDING_DIR" && echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (read-only tool allowed despite PENDING)" 0 "$TEST5_EXIT"

# Test 6: Write to ask_human.md itself, with PENDING present → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/proj/ask_human.md","content":"---\nstatus: RESOLVED\n---\n"}}'
TEST6_EXIT=$(cd "$PENDING_DIR" && echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (writing ask_human.md itself allowed)" 0 "$TEST6_EXIT"

# Test 7: Bypass env var honored on a violating (PENDING) input → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push"}}'
TEST7_EXIT=$(HOOK_BYPASS_ASYNC_HUMAN_COMMS_BLOCKS=1 bash -c "cd '$PENDING_DIR' && echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Test 8: ask_human.md without status: line in ancestor → allow (exit 0)
# Regression: pipefail on empty grep caused exit 1 + Claude Code hook spam.
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
TEST8_EXIT=$(cd "$ROOT/no-status" && echo "$TEST8_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (ask_human.md without status allows)" 0 "$TEST8_EXIT"

# Report
echo ""
echo "async-human-comms-blocks.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
