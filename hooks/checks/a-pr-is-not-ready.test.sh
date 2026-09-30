#!/bin/bash
# Test fixture for checks/a-pr-is-not-ready.sh
#
# Stop-event hook: when the turn ran `gh pr create/ready/merge`, block the
# Stop if the PR has failing CI or is BEHIND/DIRTY. Reads the transcript
# JSONL; queries `gh pr view`. Tests mock `gh`/`timeout` via a temp PATH so
# the block/allow paths are deterministic without network.
# Run: `bash a-pr-is-not-ready.test.sh`

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/a-pr-is-not-ready.sh"
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

# Mock bin: fake gh prints $MOCK_GH_OUTPUT; fake timeout/gtimeout drop the
# duration arg and exec the rest (so `timeout 5 gh ...` runs the fake gh).
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/bin/bash
printf '%s' "${MOCK_GH_OUTPUT:-}"
EOF
cat > "$TMP/bin/timeout" <<'EOF'
#!/bin/bash
shift
exec "$@"
EOF
cp "$TMP/bin/timeout" "$TMP/bin/gtimeout"
chmod +x "$TMP/bin/gh" "$TMP/bin/timeout" "$TMP/bin/gtimeout"

# Transcript fixtures (JSONL)
mk_transcript() { local f="$TMP/$1"; shift; : > "$f"; for c in "$@"; do printf '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"%s"}}]}}\n' "$c" >> "$f"; done; printf '%s' "$f"; }
stop_input() { printf '{"hook_event_name":"Stop","transcript_path":"%s"}' "$1"; }
T_NOACT="$(mk_transcript noact.jsonl 'git status')"
T_CREATE="$(mk_transcript create.jsonl 'gh pr create --title x --body y')"
T_READY="$(mk_transcript ready.jsonl 'gh pr ready 123 --repo octo/repo')"

run_plain() { printf '%s' "$1" | bash "$SCRIPT" >/dev/null 2>&1; echo $?; }
run_mocked() { # $1 = input json, $2 = MOCK_GH_OUTPUT
      env -u BASH_ENV -u ENV DOTFILES_DIR="$TMP" PATH="$TMP/bin:$PATH" MOCK_GH_OUTPUT="$2" bash -c "printf '%s' '$1' | bash '$SCRIPT' >/dev/null 2>&1; echo \$?" | tail -1
}

# Test 1: not a Stop event → bypass
assert_exit_code "Test 1 (non-Stop → bypass)" 0 "$(run_plain "{\"hook_event_name\":\"PreToolUse\",\"transcript_path\":\"$T_READY\"}")"

# Test 2: no transcript path → bypass
assert_exit_code "Test 2 (no transcript → bypass)" 0 "$(run_plain '{"hook_event_name":"Stop"}')"

# Test 3: Stop + transcript with no gh-pr activity → bypass
assert_exit_code "Test 3 (no gh pr activity → bypass)" 0 "$(run_plain "$(stop_input "$T_NOACT")")"

# Test 4: Stop + `gh pr create` only (no PR number to verify) → warn (exit 0)
assert_exit_code "Test 4 (pr create, no number → warn)" 0 "$(run_plain "$(stop_input "$T_CREATE")")"

# Test 5: Stop + `gh pr ready 123` + PR has a FAILURE check → block (exit 2)
assert_exit_code "Test 5 (failing CI → block)" 2 \
  "$(run_mocked "$(stop_input "$T_READY")" '{"statusCheckRollup":[{"conclusion":"FAILURE"}],"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}')"

# Test 6: Stop + PR is BEHIND main → block (exit 2)
assert_exit_code "Test 6 (behind main → block)" 2 \
  "$(run_mocked "$(stop_input "$T_READY")" '{"statusCheckRollup":[{"conclusion":"SUCCESS"}],"mergeStateStatus":"BEHIND","mergeable":"MERGEABLE"}')"

# Test 7: Stop + PR green + CLEAN → allow (exit 0)
assert_exit_code "Test 7 (green + clean → allow)" 0 \
  "$(run_mocked "$(stop_input "$T_READY")" '{"statusCheckRollup":[{"conclusion":"SUCCESS"}],"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}')"

# Test 8: HOOK_BYPASS env var set with a would-block (failing) PR → allow
assert_exit_code "Test 8 (HOOK_BYPASS env → allow)" 0 \
  "$(env -u BASH_ENV -u ENV DOTFILES_DIR="$TMP" PATH="$TMP/bin:$PATH" HOOK_BYPASS_A_PR_IS_NOT_READY=1 MOCK_GH_OUTPUT='{"statusCheckRollup":[{"conclusion":"FAILURE"}],"mergeStateStatus":"CLEAN"}' bash -c "printf '%s' '{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$T_READY\"}' | bash '$SCRIPT' >/dev/null 2>&1; echo \$?" | tail -1)"

echo ""
echo "a-pr-is-not-ready.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
