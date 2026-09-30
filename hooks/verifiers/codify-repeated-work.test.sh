#!/bin/bash

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/codify-repeated-work.sh"
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

PROMPT_INPUT='{"hook_event_name":"UserPromptSubmit","prompt":"keep doing the same release checklist again"}'

run_hook "block_warns" "$PROMPT_INPUT" MOCK_CLAUDE_RESPONSE="BLOCK repeated workflow should become a skill"
assert_exit_code "BLOCK response warns without blocking" 0 "$(cat "$TMPDIR/block_warns.code")"
assert_stderr_contains "BLOCK response warning" "repeated work" "$TMPDIR/block_warns.err"

run_hook "allow_silent" "$PROMPT_INPUT" MOCK_CLAUDE_RESPONSE="ALLOW one-off request"
assert_exit_code "ALLOW response exits 0" 0 "$(cat "$TMPDIR/allow_silent.code")"
assert_stderr_empty "ALLOW response is silent" "$TMPDIR/allow_silent.err"

run_hook "empty_defaults_allow" "$PROMPT_INPUT" MOCK_CLAUDE_RESPONSE=""
assert_exit_code "empty response defaults allow" 0 "$(cat "$TMPDIR/empty_defaults_allow.code")"
assert_stderr_empty "empty response is silent" "$TMPDIR/empty_defaults_allow.err"

run_hook "timeout_defaults_allow" "$PROMPT_INPUT" MOCK_CLAUDE_RESPONSE="BLOCK slow response" MOCK_CLAUDE_SLEEP=2 HOOK_VERIFIER_TIMEOUT=1
assert_exit_code "timeout defaults allow" 0 "$(cat "$TMPDIR/timeout_defaults_allow.code")"
assert_stderr_empty "timeout response is silent" "$TMPDIR/timeout_defaults_allow.err"

run_hook "missing_claude_defaults_allow" "$PROMPT_INPUT" PATH="$SYSTEM_PATH"
assert_exit_code "missing claude defaults allow" 0 "$(cat "$TMPDIR/missing_claude_defaults_allow.code")"
assert_stderr_empty "missing claude is silent" "$TMPDIR/missing_claude_defaults_allow.err"

WRONG_EVENT='{"hook_event_name":"PreToolUse","prompt":"keep doing the same thing"}'
run_hook "wrong_event" "$WRONG_EVENT" MOCK_CLAUDE_RESPONSE="BLOCK should not run"
assert_exit_code "wrong event bypasses" 0 "$(cat "$TMPDIR/wrong_event.code")"
assert_stderr_empty "wrong event is silent" "$TMPDIR/wrong_event.err"

NO_PROMPT='{"hook_event_name":"UserPromptSubmit"}'
run_hook "no_prompt" "$NO_PROMPT" MOCK_CLAUDE_RESPONSE="BLOCK should not run"
assert_exit_code "missing prompt bypasses" 0 "$(cat "$TMPDIR/no_prompt.code")"
assert_stderr_empty "missing prompt is silent" "$TMPDIR/no_prompt.err"

run_hook "bypass" "$PROMPT_INPUT" MOCK_CLAUDE_RESPONSE="BLOCK should not run" HOOK_BYPASS_CODIFY_REPEATED_WORK=1
assert_exit_code "bypass env allows" 0 "$(cat "$TMPDIR/bypass.code")"
assert_stderr_empty "bypass env is silent" "$TMPDIR/bypass.err"

echo ""
echo "codify-repeated-work.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
