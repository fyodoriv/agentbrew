#!/bin/bash

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/browser-errors-before-done.sh"
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

write_transcript() {
  local path="$1"
  local body="$2"
  printf '%s\n' "$body" > "$path"
}

run_hook() {
  local label="$1"
  local transcript="$2"
  shift 2
  local out="$TMPDIR/$label.out"
  local err="$TMPDIR/$label.err"
  local input
  input=$(printf '{"hook_event_name":"Stop","transcript_path":"%s"}' "$transcript")
  env -u BASH_ENV -u ENV DOTFILES_DIR="$TMPDIR" HOME="$TMPDIR/home" PATH="$BASE_PATH" "$@" bash "$SCRIPT" >"$out" 2>"$err" <<<"$input"
  printf '%s\n' "$?" > "$TMPDIR/$label.code"
}

FRONTEND_TRANSCRIPT="$TMPDIR/frontend.jsonl"
write_transcript "$FRONTEND_TRANSCRIPT" '{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/App.tsx"}},{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}'

run_hook "block_warns" "$FRONTEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE="BLOCK no browser check"
assert_exit_code "BLOCK response warns without blocking" 0 "$(cat "$TMPDIR/block_warns.code")"
assert_stderr_contains "BLOCK response warning" "browser console/network" "$TMPDIR/block_warns.err"

run_hook "allow_silent" "$FRONTEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE="ALLOW page-zero-errors ran"
assert_exit_code "ALLOW response exits 0" 0 "$(cat "$TMPDIR/allow_silent.code")"
assert_stderr_empty "ALLOW response is silent" "$TMPDIR/allow_silent.err"

run_hook "empty_defaults_allow" "$FRONTEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE=""
assert_exit_code "empty response defaults allow" 0 "$(cat "$TMPDIR/empty_defaults_allow.code")"
assert_stderr_empty "empty response is silent" "$TMPDIR/empty_defaults_allow.err"

run_hook "timeout_defaults_allow" "$FRONTEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE="BLOCK slow" MOCK_CLAUDE_SLEEP=2 HOOK_VERIFIER_TIMEOUT=1
assert_exit_code "timeout defaults allow" 0 "$(cat "$TMPDIR/timeout_defaults_allow.code")"
assert_stderr_empty "timeout response is silent" "$TMPDIR/timeout_defaults_allow.err"

BACKEND_TRANSCRIPT="$TMPDIR/backend.jsonl"
write_transcript "$BACKEND_TRANSCRIPT" '{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/server.ts"}}]}}'
run_hook "backend_bypass" "$BACKEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE="BLOCK should not run"
assert_exit_code "non-frontend edit bypasses" 0 "$(cat "$TMPDIR/backend_bypass.code")"
assert_stderr_empty "non-frontend edit is silent" "$TMPDIR/backend_bypass.err"

run_hook "bypass" "$FRONTEND_TRANSCRIPT" MOCK_CLAUDE_RESPONSE="BLOCK should not run" HOOK_BYPASS_BROWSER_ERRORS_BEFORE_DONE=1
assert_exit_code "bypass env allows" 0 "$(cat "$TMPDIR/bypass.code")"
assert_stderr_empty "bypass env is silent" "$TMPDIR/bypass.err"

echo ""
echo "browser-errors-before-done.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
