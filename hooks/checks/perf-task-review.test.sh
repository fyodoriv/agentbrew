#!/bin/bash
# Test fixture for checks/perf-task-review.sh
#
# Stop hook: blocks once (JSON decision on stdout) when this turn's tool time
# reaches the threshold; silent below it and when stop_hook_active is true.
# Run: `bash perf-task-review.test.sh`

set -uo pipefail

HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")"
SCRIPT="$HERE/perf-task-review.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
export AGENTBREW_PERF_HELPER="$HERE/../../templates/scripts/agent-perf.mjs"
unset MINSKY_PIPELINE AGENTBREW_PERF_REVIEW_MIN_SECS HOOK_BYPASS_PERF_TASK_REVIEW
mkdir -p "$HOME" "$XDG_STATE_HOME/agentbrew/perf"
LOG="$XDG_STATE_HOME/agentbrew/perf/$(date -u +%Y-%m).jsonl"
PASS=0
FAIL=0
FAIL_DETAILS=()

check() { # $1 label, $2 condition result (0 = pass)
  if [ "$2" = "0" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$1")
  fi
}

row() { # $1 sid, $2 key, $3 ms
  printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","tool":"Bash","ms":%s,"ok":true,"key":"%s","agent":null}\n' "$1" "$3" "$2" >>"$LOG"
}
turn() { printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","ev":"turn"}\n' "$1" >>"$LOG"; }
run_hook() { # $1 input json; prints stdout, sets RC file
  printf '%s' "$1" | bash "$SCRIPT" 2>/dev/null
  echo $? >"$TMP/rc"
}

# Session "long": an old slow turn, then a 6m40s turn.
row long "old step" 900000
turn long
row long "npm run verify" 240000
row long "bats <path>" 130000
row long "git push" 30000
# Session "short": 20 seconds of tools.
turn short
row short "npm test" 20000

# Test 1: long turn → block JSON naming the slowest steps of this turn only.
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"long","stop_hook_active":false}')"
check "Test 1a (exit 0)" "$([ "$(cat "$TMP/rc")" = 0 ] && echo 0 || echo 1)"
check "Test 1b (decision block: $OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block"' >/dev/null && echo 0 || echo 1)"
REASON="$(printf '%s' "$OUT" | jq -r '.reason // ""')"
check "Test 1c (reason lists steps and time)" "$(case "$REASON" in *"6m40s in tools"*"npm run verify 4m0s, bats <path> 2m10s, git push 30s"*"Time review"*) echo 0 ;; *) echo 1 ;; esac)"
check "Test 1d (reason ignores the previous turn)" "$(case "$REASON" in *"old step"*) echo 1 ;; *) echo 0 ;; esac)"

# Test 2: stop_hook_active → silent (the loop guard).
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"long","stop_hook_active":true}')"
check "Test 2 (stop_hook_active → no output)" "$([ -z "$OUT" ] && [ "$(cat "$TMP/rc")" = 0 ] && echo 0 || echo 1)"

# Test 3: short turn → silent.
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"short","stop_hook_active":false}')"
check "Test 3 (below threshold → no output)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

# Test 4: a lower threshold makes the short turn block.
OUT="$(AGENTBREW_PERF_REVIEW_MIN_SECS=10 run_hook '{"hook_event_name":"Stop","session_id":"short","stop_hook_active":false}')"
check "Test 4 (MIN_SECS=10 → block: $OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block" and (.reason|contains("threshold 10s"))' >/dev/null && echo 0 || echo 1)"

# Test 5: bypass, pipeline mode, unknown session, and a missing helper → silent.
OUT1="$(HOOK_BYPASS_PERF_TASK_REVIEW=1 run_hook '{"session_id":"long","stop_hook_active":false}')"
OUT2="$(MINSKY_PIPELINE=1 run_hook '{"session_id":"long","stop_hook_active":false}')"
OUT3="$(run_hook '{"session_id":"nobody","stop_hook_active":false}')"
OUT4="$(AGENTBREW_PERF_HELPER="$TMP/missing.mjs" run_hook '{"session_id":"long","stop_hook_active":false}')"
check "Test 5 (bypass/pipeline/unknown/missing → silent)" "$([ -z "$OUT1$OUT2$OUT3$OUT4" ] && echo 0 || echo 1)"

echo ""
echo "perf-task-review.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
