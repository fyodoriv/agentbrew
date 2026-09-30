#!/bin/bash

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/rule-skill-location.sh"
TMPDIR="$(mktemp -d)"
MOCK_BIN="$TMPDIR/bin"
mkdir -p "$MOCK_BIN" "$TMPDIR/home"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$MOCK_BIN/claude" <<'MOCK'
#!/bin/bash
if [ -n "${MOCK_CLAUDE_SLEEP:-}" ]; then
  sleep "$MOCK_CLAUDE_SLEEP"
fi
printf '%s' "${MOCK_CLAUDE_RESPONSE:-ALLOW mock}"
MOCK
chmod +x "$MOCK_BIN/claude"

PASS=0
FAIL=0
FAIL_DETAILS=()
SYSTEM_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
BASE_PATH="$MOCK_BIN:$SYSTEM_PATH"

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
  local pattern="$2"
  local file="$3"
  if grep -q "$pattern" "$file"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected stderr to contain '$pattern'")
  fi
}

assert_stderr_empty() {
  local label="$1"
  local file="$2"
  if [ ! -s "$file" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected empty stderr, got $(cat "$file")")
  fi
}

run_hook() {
  local label="$1"
  local input="$2"
  shift 2
  local out="$TMPDIR/$label.out"
  local err="$TMPDIR/$label.err"
  env -u BASH_ENV -u ENV DOTFILES_DIR="$TMPDIR" HOME="$TMPDIR/home" PATH="$BASE_PATH" "$@" bash "$SCRIPT" >"$out" 2>"$err" <<<"$input"
  local code=$?
  printf '%s\n' "$code" > "$TMPDIR/$label.code"
}

WRITE_SKILL='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/.claude/skills/example/SKILL.md","content":"# Example skill"}}'

run_hook "block_warns" "$WRITE_SKILL" MOCK_CLAUDE_RESPONSE="BLOCK team-specific skill belongs in the team registry"
assert_exit_code "BLOCK response warns without blocking" 0 "$(cat "$TMPDIR/block_warns.code")"
assert_stderr_contains "BLOCK response warning" "routing matrix" "$TMPDIR/block_warns.err"

run_hook "allow_silent" "$WRITE_SKILL" MOCK_CLAUDE_RESPONSE="ALLOW correct repo-local skill path"
assert_exit_code "ALLOW response exits 0" 0 "$(cat "$TMPDIR/allow_silent.code")"
assert_stderr_empty "ALLOW response is silent" "$TMPDIR/allow_silent.err"

run_hook "empty_defaults_allow" "$WRITE_SKILL" MOCK_CLAUDE_RESPONSE=""
assert_exit_code "empty response defaults allow" 0 "$(cat "$TMPDIR/empty_defaults_allow.code")"
assert_stderr_empty "empty response is silent" "$TMPDIR/empty_defaults_allow.err"

run_hook "timeout_defaults_allow" "$WRITE_SKILL" MOCK_CLAUDE_RESPONSE="BLOCK slow response" MOCK_CLAUDE_SLEEP=2 HOOK_VERIFIER_TIMEOUT=1
assert_exit_code "timeout defaults allow" 0 "$(cat "$TMPDIR/timeout_defaults_allow.code")"
assert_stderr_empty "timeout response is silent" "$TMPDIR/timeout_defaults_allow.err"

run_hook "missing_claude_defaults_allow" "$WRITE_SKILL" PATH="$SYSTEM_PATH"
assert_exit_code "missing claude defaults allow" 0 "$(cat "$TMPDIR/missing_claude_defaults_allow.code")"
assert_stderr_empty "missing claude is silent" "$TMPDIR/missing_claude_defaults_allow.err"

IRRELEVANT_PATH='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/repo/src/app.ts","content":"export const x = 1;"}}'
run_hook "irrelevant_path" "$IRRELEVANT_PATH" MOCK_CLAUDE_RESPONSE="BLOCK should not run"
assert_exit_code "irrelevant path bypasses" 0 "$(cat "$TMPDIR/irrelevant_path.code")"
assert_stderr_empty "irrelevant path is silent" "$TMPDIR/irrelevant_path.err"

IRRELEVANT_TOOL='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
run_hook "irrelevant_tool" "$IRRELEVANT_TOOL" MOCK_CLAUDE_RESPONSE="BLOCK should not run"
assert_exit_code "irrelevant tool bypasses" 0 "$(cat "$TMPDIR/irrelevant_tool.code")"
assert_stderr_empty "irrelevant tool is silent" "$TMPDIR/irrelevant_tool.err"

run_hook "bypass" "$WRITE_SKILL" MOCK_CLAUDE_RESPONSE="BLOCK should not run" HOOK_BYPASS_RULE_SKILL_LOCATION=1
assert_exit_code "bypass env allows" 0 "$(cat "$TMPDIR/bypass.code")"
assert_stderr_empty "bypass env is silent" "$TMPDIR/bypass.err"

echo ""
echo "rule-skill-location.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
