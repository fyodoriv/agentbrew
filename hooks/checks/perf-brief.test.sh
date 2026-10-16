#!/bin/bash
# Test fixture for checks/perf-brief.sh
#
# SessionStart hook: prints SessionStart additionalContext JSON with the
# project's agent time brief; silent when the project has no perf rows.
# Run: `bash perf-brief.test.sh`

set -uo pipefail

HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")"
SCRIPT="$HERE/perf-brief.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
export AGENTBREW_PERF_HELPER="$HERE/../../templates/scripts/agent-perf.mjs"
unset HOOK_BYPASS_PERF_BRIEF
mkdir -p "$HOME" "$XDG_STATE_HOME/agentbrew/perf" "$TMP/work/alpha/.git" "$TMP/work/empty/.git"
LOG="$XDG_STATE_HOME/agentbrew/perf/$(date -u +%Y-%m).jsonl"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

for ms in 60000 70000 80000; do
  printf '{"project":"alpha","ts":"%s","sid":"s1","tool":"Bash","ms":%s,"ok":true,"key":"npm run verify","agent":null}\n' "$NOW" "$ms" >>"$LOG"
done

# Test 1: a project with rows → SessionStart additionalContext with the brief.
OUT="$(printf '{"hook_event_name":"SessionStart","source":"startup","cwd":"%s"}' "$TMP/work/alpha" | bash "$SCRIPT" 2>/dev/null)"
RC=$?
check "Test 1a (exit 0)" "$([ "$RC" = 0 ] && echo 0 || echo 1)"
check "Test 1b (SessionStart JSON: $OUT)" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName=="SessionStart"' >/dev/null && echo 0 || echo 1)"
CONTEXT="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""')"
check "Test 1c (brief names the project and top step)" "$(case "$CONTEXT" in *"alpha"*"npm run verify 3m30s"*) echo 0 ;; *) echo 1 ;; esac)"
check "Test 1d (brief has at most 5 lines)" "$([ "$(printf '%s\n' "$CONTEXT" | wc -l)" -le 5 ] && echo 0 || echo 1)"

# Test 2: a project without rows → silent.
OUT="$(printf '{"hook_event_name":"SessionStart","cwd":"%s"}' "$TMP/work/empty" | bash "$SCRIPT" 2>/dev/null)"
check "Test 2 (no rows → no output)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

# Test 3: bypass and a missing helper → silent.
OUT1="$(printf '{"cwd":"%s"}' "$TMP/work/alpha" | HOOK_BYPASS_PERF_BRIEF=1 bash "$SCRIPT" 2>/dev/null)"
OUT2="$(printf '{"cwd":"%s"}' "$TMP/work/alpha" | AGENTBREW_PERF_HELPER="$TMP/missing.mjs" bash "$SCRIPT" 2>/dev/null)"
check "Test 3 (bypass / missing helper → silent)" "$([ -z "$OUT1$OUT2" ] && echo 0 || echo 1)"

echo ""
echo "perf-brief.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
