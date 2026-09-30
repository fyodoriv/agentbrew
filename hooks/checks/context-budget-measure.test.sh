#!/bin/bash
# Test fixture for checks/context-budget-measure.sh
#
# SessionStart hook: schedules throttled background capture; always allow.
# Run: `bash context-budget-measure.test.sh`

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/context-budget-measure.sh"
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

run_hook() { # $1 = input json
  local input="$1"
  local rc
  rc=$(printf '%s' "$input" | bash "$SCRIPT" >/dev/null 2>&1; echo $?)
  printf '%s' "$rc" | tail -1
}

# Test 1: SessionStart → allow (exit 0) even when agentbrew missing (bypass)
T1=$(run_hook '{"hook_event_name":"SessionStart"}')
assert_exit_code "Test 1 (SessionStart → allow)" 0 "$T1"

# Test 2: non-SessionStart event → bypass (exit 0)
T2=$(run_hook '{"hook_event_name":"Stop"}')
assert_exit_code "Test 2 (Stop → bypass)" 0 "$T2"

# Test 3: HOOK_BYPASS → allow
T3=$(HOOK_BYPASS_CONTEXT_BUDGET_MEASURE=1 bash -c "printf '%s' '{\"hook_event_name\":\"SessionStart\"}' | bash '$SCRIPT' >/dev/null 2>&1; echo \$?" | tail -1)
assert_exit_code "Test 3 (HOOK_BYPASS → allow)" 0 "$T3"

# Test 4: empty stdin → allow (treat as SessionStart-compatible)
T4=$(run_hook '{}')
assert_exit_code "Test 4 (empty stdin → allow)" 0 "$T4"

# Test 5: low headroom in latest.json → warn (exit 0, stderr message)
METRICS_DIR="$TMP/.config/agentbrew/metrics"
mkdir -p "$METRICS_DIR"
cat > "$METRICS_DIR/latest.json" <<'JSON'
{
  "static": {
    "softTokenHeadroom": 1668,
    "projectedDeployedTokens": 6332,
    "topSections": [{ "heading": "Git and delivery", "tokens": 972 }]
  }
}
JSON
export HOME="$TMP"
T5_RC=$(printf '%s' '{"hook_event_name":"SessionStart"}' | bash "$SCRIPT" 2>"$TMP/stderr.txt"; echo $?)
T5_ERR=$(cat "$TMP/stderr.txt" 2>/dev/null || true)
assert_exit_code "Test 5 (low headroom → warn exit 0)" 0 "$T5_RC"
if echo "$T5_ERR" | grep -q "context headroom low"; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAIL_DETAILS+=("Test 5: expected headroom warning on stderr")
fi

echo ""
echo "context-budget-measure.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
