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
# Version-manager shims (Volta, asdf) find node under $HOME; pin the real binary first.
NODE_BIN="$(node -p 'process.execPath' 2>/dev/null || true)"
if [ -n "$NODE_BIN" ]; then
  mkdir -p "$TMP/node-bin"
  ln -sf "$NODE_BIN" "$TMP/node-bin/node"
  export PATH="$TMP/node-bin:$PATH"
fi
export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
export AGENTBREW_PERF_HELPER="$HERE/../../templates/scripts/agent-perf.mjs"
unset MINSKY_PIPELINE AGENTBREW_PERF_REVIEW_MIN_SECS AGENTBREW_PERF_REVIEW_MIN_BLOCKED HOOK_BYPASS_PERF_TASK_REVIEW
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
attempt() { # $1 sid, $2 key, $3 id
  printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","ev":"attempt","tool":"Bash","key":"%s","id":"%s","agent":null}\n' "$1" "$2" "$3" >>"$LOG"
}
done_row() { # $1 sid, $2 key, $3 id
  printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","tool":"Bash","ms":10,"ok":true,"key":"%s","id":"%s","agent":null}\n' "$1" "$2" "$3" >>"$LOG"
}
bg_launch() { # $1 sid, $2 id: a background Agent launch (its attempt row only)
  printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","ev":"attempt","tool":"Agent","key":"agent:general-purpose","id":"%s","agent":null,"bg":true}\n' "$1" "$2" >>"$LOG"
}
denied() { # $1 sid, $2 key, $3 id
  printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"%s","ev":"denied","tool":"Bash","key":"%s","id":"%s","agent":null}\n' "$1" "$2" "$3" >>"$LOG"
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
check "Test 1c (reason lists steps and time)" "$(case "$REASON" in (*"6m40s in tools"*"npm run verify 4m0s, bats <path> 2m10s, git push 30s"*"Time review"*) echo 0 ;; (*) echo 1 ;; esac)"
check "Test 1d (reason ignores the previous turn)" "$(case "$REASON" in (*"old step"*) echo 1 ;; (*) echo 0 ;; esac)"

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

# Session "blocked": a short turn with 3 calls that never ran and 1 that ran.
turn blocked
attempt blocked "cd <path>" t1
attempt blocked "cd <path>" t2
attempt blocked "Edit:ts" t3
attempt blocked "npm test" t4
done_row blocked "npm test" t4
# Session "two": only 2 blocked calls.
turn two
attempt two "cd <path>" u1
attempt two "cd <path>" u2

# Test 6: 3 blocked calls in a short turn → block that lists them.
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"blocked","stop_hook_active":false}')"
REASON="$(printf '%s' "$OUT" | jq -r '.reason // ""')"
check "Test 6a (3 blocked → block: $OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block"' >/dev/null 2>&1 && echo 0 || echo 1)"
check "Test 6b (reason lists blocked calls)" "$(case "$REASON" in (*"3 tool calls never ran"*"cd <path> 2x, Edit:ts 1x"*"split"*) echo 0 ;; (*) echo 1 ;; esac)"
check "Test 6c (the call that ran is not listed)" "$(case "$REASON" in (*"npm test"*) echo 1 ;; (*) echo 0 ;; esac)"

# Test 7: 2 blocked calls → silent; MIN_BLOCKED=2 → block.
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"two","stop_hook_active":false}')"
check "Test 7a (2 blocked → no output: $OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"
OUT="$(AGENTBREW_PERF_REVIEW_MIN_BLOCKED=2 run_hook '{"hook_event_name":"Stop","session_id":"two","stop_hook_active":false}')"
check "Test 7b (MIN_BLOCKED=2 → block: $OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block" and (.reason|contains("2 tool calls never ran"))' >/dev/null 2>&1 && echo 0 || echo 1)"

# Test 8: a long turn with 3 blocked calls lists both the slow steps and the blocked calls.
attempt long "cd <path>" v1
attempt long "cd <path>" v2
attempt long "cd <path>" v3
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"long","stop_hook_active":false}')"
REASON="$(printf '%s' "$OUT" | jq -r '.reason // ""')"
check "Test 8 (time + blocked in one reason)" "$(case "$REASON" in (*"6m40s in tools"*"3 tool calls never ran"*) echo 0 ;; (*) echo 1 ;; esac)"

# Session "dispatch": 4 background Agent launches (no completion row) and 1 denied call.
turn dispatch
for n in 1 2 3 4; do bg_launch dispatch "w$n"; done
attempt dispatch "git push" w5
denied dispatch "git push" w5
# A background launch that was denied still counts as never ran.
turn bgdenied
bg_launch bgdenied x1
printf '{"project":"p","ts":"2026-10-15T12:00:00Z","sid":"bgdenied","ev":"denied","tool":"Agent","key":"agent:general-purpose","id":"x1","agent":null}\n' >>"$LOG"

# Test 9: background launches count as ran; only the denied call is flagged.
OUT="$(run_hook '{"hook_event_name":"Stop","session_id":"dispatch","stop_hook_active":false}')"
check "Test 9a (4 background launches + 1 denied → below MIN_BLOCKED 3: $OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"
OUT="$(AGENTBREW_PERF_REVIEW_MIN_BLOCKED=1 run_hook '{"hook_event_name":"Stop","session_id":"dispatch","stop_hook_active":false}')"
REASON="$(printf '%s' "$OUT" | jq -r '.reason // ""')"
check "Test 9b (denied call still flagged: $REASON)" "$(case "$REASON" in (*"1 tool calls never ran"*"git push 1x"*) echo 0 ;; (*) echo 1 ;; esac)"
check "Test 9c (no agent launch flagged)" "$(case "$REASON" in (*"agent:"*) echo 1 ;; (*) echo 0 ;; esac)"

# Test 10: a denied background launch is still flagged.
OUT="$(AGENTBREW_PERF_REVIEW_MIN_BLOCKED=1 run_hook '{"hook_event_name":"Stop","session_id":"bgdenied","stop_hook_active":false}')"
check "Test 10 (denied background launch flagged: $OUT)" "$(printf '%s' "$OUT" | jq -e '.reason|contains("agent:general-purpose 1x")' >/dev/null 2>&1 && echo 0 || echo 1)"

echo ""
echo "perf-task-review.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
