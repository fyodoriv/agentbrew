#!/bin/bash
# Shared fixture helpers for Cat B verifier .test.sh files.

cat_b_fixture_setup() {
  SCRIPT="$1"
  HOOK_BYPASS_ENV="$2"
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
}

cat_b_assert_exit_code() {
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

cat_b_assert_stderr_contains() {
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

cat_b_assert_stderr_empty() {
  local label="$1"
  local file="$2"
  if [ ! -s "$file" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected empty stderr, got $(cat "$file")")
  fi
}

cat_b_run_hook() {
  local label="$1"
  local input="$2"
  shift 2
  local out="$TMPDIR/$label.out"
  local err="$TMPDIR/$label.err"
  env -u BASH_ENV -u ENV DOTFILES_DIR="$TMPDIR" HOME="$TMPDIR/home" PATH="$BASE_PATH" "$@" bash "$SCRIPT" >"$out" 2>"$err" <<<"$input"
  local code=$?
  printf '%s\n' "$code" > "$TMPDIR/$label.code"
}

cat_b_finish() {
  local hook_name="$1"
  echo ""
  echo "$hook_name: $PASS passed, $FAIL failed"
  if [ "$FAIL" -gt 0 ]; then
    for detail in "${FAIL_DETAILS[@]}"; do
      echo "  ✗ $detail"
    done
    exit 1
  fi
  exit 0
}
