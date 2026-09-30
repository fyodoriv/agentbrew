#!/bin/bash
# Sandbox PATH simulation for bootstrap-endpoint-path.sh
# Run: bash hooks/lib/bootstrap-endpoint-path.test.sh

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
PASS=0
FAIL=0
FAIL_DETAILS=()

assert_nonempty() {
  local label="$1" value="$2"
  if [ -n "$value" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected non-empty value")
  fi
}

assert_not_system_jq() {
  local label="$1" jq_path="$2"
  case "$jq_path" in
    /usr/bin/jq)
      FAIL=$((FAIL + 1))
      FAIL_DETAILS+=("$label: resolved to /usr/bin/jq on sandbox PATH")
      ;;
    *)
      PASS=$((PASS + 1))
      ;;
  esac
}

# Test 1: sourcing bootstrap on minimal PATH resolves jq outside /usr/bin when dotfiles exists
DOTFILES_DIR="${DOTFILES_DIR:-$HOME/apps/tooling/dotfiles}"
if [ -d "$DOTFILES_DIR/bin" ]; then
  JQ_RESOLVED="$(
    env -i HOME="$HOME" DOTFILES_DIR="$DOTFILES_DIR" PATH="/usr/bin:/bin" bash -c "
      source '$LIB_DIR/bootstrap-endpoint-path.sh'
      printf '%s' \"\${DOTFILES_JQ:-}\"
    " 2>/dev/null || true
  )"
  if [ -z "$JQ_RESOLVED" ]; then
    JQ_RESOLVED="$(
      env -i HOME="$HOME" DOTFILES_DIR="$DOTFILES_DIR" PATH="/usr/bin:/bin" bash -c "
        source '$LIB_DIR/bootstrap-endpoint-path.sh'
        command -v jq 2>/dev/null || true
      " 2>/dev/null || true
    )"
  fi
  assert_nonempty "Test 1 (sandbox PATH resolves jq)" "$JQ_RESOLVED"
  assert_not_system_jq "Test 1 (jq not /usr/bin)" "$JQ_RESOLVED"
else
  echo "skip: dotfiles bin not present at $DOTFILES_DIR/bin"
fi

# Test 2: verify-before-completion json_get works on sandbox PATH
VERIFY_SCRIPT="$REPO_ROOT/hooks/checks/verify-before-completion.sh"
if [ -x "$VERIFY_SCRIPT" ] || [ -f "$VERIFY_SCRIPT" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  EDIT_TS='{"message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/foo.ts"}}]}}'
  TRANSCRIPT="$TMP/transcript.jsonl"
  printf '%s\n' "$EDIT_TS" > "$TRANSCRIPT"
  RC="$(
    env -i HOME="$HOME" DOTFILES_DIR="$DOTFILES_DIR" PATH="/usr/bin:/bin" bash -c "
      printf '%s' '{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$TRANSCRIPT\"}' | bash '$VERIFY_SCRIPT' >/dev/null 2>&1; echo \$?
    " 2>/dev/null | tail -1
  )"
  if [ "$RC" = "2" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("Test 2 (verify-before-completion blocks on sandbox PATH): expected exit 2, got $RC")
  fi
fi

# Test 3: log-decision writes a line when jq is bootstrapped
LOG_TMP="$(mktemp -d)"
LOG_FILE="$LOG_TMP/hook-decisions.jsonl"
RC_LOG="$(
  env -i HOME="$HOME" DOTFILES_DIR="$DOTFILES_DIR" PATH="/usr/bin:/bin" bash -c "
    source '$LIB_DIR/log-decision.sh'
    log_decision 'bootstrap-test' 'allow' 'sandbox-path'
    test -s '$LOG_FILE' && echo ok || echo fail
  " 2>/dev/null || echo fail
)"
# log-decision uses ~/.cache/agentbrew — check that path instead
CACHE_LOG="${HOME}/.cache/agentbrew/hook-decisions.jsonl"
if [ -f "$CACHE_LOG" ] && tail -1 "$CACHE_LOG" | grep -q 'bootstrap-test'; then
  PASS=$((PASS + 1))
else
  if [ "$RC_LOG" = "ok" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("Test 3 (log-decision on sandbox PATH): no log line written")
  fi
fi

echo ""
echo "bootstrap-endpoint-path.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
