#!/bin/bash
# Test fixture for checks/memory-sync-projects-session-end.sh.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/memory-sync-projects-session-end.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKE_HOME="$TMP/home"
DOTFILES_ROOT="$TMP/dotfiles"
STUB_DIR="$DOTFILES_ROOT/bin"
LOG="$TMP/agentbrew.log"
mkdir -p "$FAKE_HOME" "$STUB_DIR"

cat >"$STUB_DIR/agentbrew" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$AGENTBREW_LOG"
if [ -n "${AGENTBREW_MEMORY_SYNC_RECEIPT_PATH:-}" ]; then
  mkdir -p "$(dirname "$AGENTBREW_MEMORY_SYNC_RECEIPT_PATH")"
  cat >"$AGENTBREW_MEMORY_SYNC_RECEIPT_PATH" <<EOF
{
  "version": 1,
  "scheduledAt": "${AGENTBREW_MEMORY_SYNC_SCHEDULED_AT:-2026-09-24T12:00:00Z}",
  "startedAt": "${AGENTBREW_MEMORY_SYNC_STARTED_AT:-2026-09-24T12:00:00Z}",
  "completedAt": "2026-09-24T12:00:01Z",
  "elapsedMs": 1,
  "outcome": "${AGENTBREW_STUB_OUTCOME:-ok}",
  "stores": 1,
  "synced": 1,
  "skipped": 0,
  "unchanged": 0
}
EOF
fi
exit "${AGENTBREW_STUB_EXIT:-0}"
STUB
chmod +x "$STUB_DIR/agentbrew"

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

reset_runtime() {
  rm -rf "$FAKE_HOME"
  mkdir -p "$FAKE_HOME"
  rm -f "$LOG"
  unset AGENTBREW_STUB_EXIT AGENTBREW_STUB_OUTCOME
}

run_hook() {
  local input="$1"
  printf '%s' "$input" | env \
    BASH_ENV= \
    ENV= \
    HOME="$FAKE_HOME" \
    XDG_CACHE_HOME="$FAKE_HOME/.cache" \
    XDG_STATE_HOME="$FAKE_HOME/.local/state" \
    PATH="$STUB_DIR:$PATH" \
    DOTFILES_DIR="$DOTFILES_ROOT" \
    AGENTBREW_LOG="$LOG" \
    bash "$SCRIPT" >/dev/null 2>&1
}

receipt_path() {
  printf '%s\n' "$FAKE_HOME/.local/state/agentbrew/memory-sync-projects-scheduler.json"
}

wait_for_sync() {
  for _ in $(seq 1 20); do
    [ -s "$LOG" ] && return 0
    sleep 0.05
  done
  return 1
}

wait_for_success() {
  local path
  path="$(last_success_path)"
  for _ in $(seq 1 20); do
    [ -s "$path" ] && return 0
    sleep 0.05
  done
  return 1
}

last_success_path() {
  printf '%s\n' "$FAKE_HOME/.cache/agentbrew/memory-sync-projects.last-success"
}

wait_for_outcome() {
  local expected="$1"
  local path
  path="$(receipt_path)"
  for _ in $(seq 1 20); do
    grep -q "\"outcome\": \"$expected\"" "$path" 2>/dev/null && return 0
    sleep 0.05
  done
  return 1
}

wait_for_log_lines() {
  local expected="$1"
  for _ in $(seq 1 20); do
    [ -f "$LOG" ] && [ "$(wc -l <"$LOG" | tr -d ' ')" = "$expected" ] && return 0
    sleep 0.05
  done
  return 1
}

wait_for_no_lock() {
  local lock_path="$FAKE_HOME/.cache/agentbrew/memory-sync-projects.lock"
  for _ in $(seq 1 20); do
    [ ! -e "$lock_path" ] && return 0
    sleep 0.05
  done
  return 1
}

reset_runtime
run_hook '{"hook_event_name":"SessionEnd"}'
T1=$?
assert_exit_code "Test 1 (SessionEnd allows immediately)" 0 "$T1"
if wait_for_sync && wait_for_success && wait_for_outcome "ok" && wait_for_no_lock && grep -qx 'memory sync-projects --quiet --json' "$LOG"; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 1: expected background agentbrew sync")
fi

run_hook '{"hook_event_name":"SessionEnd"}'
T2=$?
assert_exit_code "Test 2 (debounced SessionEnd allows)" 0 "$T2"
if wait_for_log_lines 1; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 2: expected debounce to avoid a second sync")
fi

reset_runtime
run_hook '{"hook_event_name":"Stop"}'
T3=$?
assert_exit_code "Test 3 (other event bypasses)" 0 "$T3"
if [ ! -e "$LOG" ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 3: unexpected sync for non-SessionEnd event")
fi

reset_runtime
printf '%s' '{"hook_event_name":"SessionEnd"}' | env \
  BASH_ENV= \
  ENV= \
  HOME="$FAKE_HOME" \
  XDG_CACHE_HOME="$FAKE_HOME/.cache" \
  XDG_STATE_HOME="$FAKE_HOME/.local/state" \
  PATH="$STUB_DIR:$PATH" \
  DOTFILES_DIR="$DOTFILES_ROOT" \
  AGENTBREW_LOG="$LOG" \
  HOOK_BYPASS_MEMORY_SYNC_PROJECTS=1 \
  bash "$SCRIPT" >/dev/null 2>&1
T4=$?
assert_exit_code "Test 4 (explicit bypass allows)" 0 "$T4"
if [ ! -e "$LOG" ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 4: bypass scheduled a sync")
fi

reset_runtime
printf '%s' '{"hook_event_name":"SessionEnd"}' | env \
  BASH_ENV= \
  ENV= \
  HOME="$FAKE_HOME" \
  XDG_CACHE_HOME="$FAKE_HOME/.cache" \
  XDG_STATE_HOME="$FAKE_HOME/.local/state" \
  PATH="/usr/bin:/bin" \
  DOTFILES_MEMORY_AGENTBREW_BIN="$STUB_DIR/agentbrew" \
  AGENTBREW_LOG="$LOG" \
  bash "$SCRIPT" >/dev/null 2>&1
T5=$?
assert_exit_code "Test 5 (Dotfiles AgentBrew override allows immediately)" 0 "$T5"
if wait_for_sync && wait_for_success && wait_for_no_lock && grep -qx 'memory sync-projects --quiet --json' "$LOG"; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 5: expected override AgentBrew sync")
fi

reset_runtime
export AGENTBREW_STUB_EXIT=1
run_hook '{"hook_event_name":"SessionEnd"}'
T6=$?
assert_exit_code "Test 6 (failed child still allows immediately)" 0 "$T6"
if wait_for_sync && wait_for_outcome "error" && wait_for_no_lock; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 6: expected a durable error receipt")
fi
run_hook '{"hook_event_name":"SessionEnd"}'
T7=$?
assert_exit_code "Test 7 (failed child is retried)" 0 "$T7"
if wait_for_log_lines 2 && wait_for_outcome "error" && wait_for_no_lock; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 7: expected retry after failed child")
fi
unset AGENTBREW_STUB_EXIT

reset_runtime
mkdir -p "$(dirname "$(last_success_path)")" "$(dirname "$(receipt_path)")"
date +%s >"$(last_success_path)"
cat >"$(receipt_path)" <<'EOF'
{"version":1,"outcome":"degraded"}
EOF
run_hook '{"hook_event_name":"SessionEnd"}'
T8=$?
assert_exit_code "Test 8 (degraded receipt bypasses a fresh success debounce)" 0 "$T8"
if wait_for_sync && wait_for_success && wait_for_outcome "ok" && wait_for_no_lock; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 8: expected retry after a degraded receipt")
fi

reset_runtime
export AGENTBREW_STUB_OUTCOME=degraded
run_hook '{"hook_event_name":"SessionEnd"}'
T9=$?
assert_exit_code "Test 9 (degraded child still allows immediately)" 0 "$T9"
if wait_for_sync && wait_for_outcome "degraded" && [ ! -e "$(last_success_path)" ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 9: expected the degraded receipt without a success debounce")
fi
unset AGENTBREW_STUB_OUTCOME
run_hook '{"hook_event_name":"SessionEnd"}'
T10=$?
assert_exit_code "Test 10 (degraded child is retried)" 0 "$T10"
if wait_for_log_lines 2 && wait_for_success && wait_for_outcome "ok" && wait_for_no_lock; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 10: expected retry after a degraded child")
fi

echo ""
echo "memory-sync-projects-session-end.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
