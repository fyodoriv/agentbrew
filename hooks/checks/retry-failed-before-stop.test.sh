#!/bin/bash
# Test fixture for checks/retry-failed-before-stop.sh
#
# Stop hook: blocks once when a tool call in this turn failed and was never
# retried with success. Silent otherwise, on stop_hook_active, and on bypass.
# Run: `bash retry-failed-before-stop.test.sh`

set -uo pipefail

HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")"
SCRIPT="$HERE/retry-failed-before-stop.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOTFILES_JQ="$(command -v jq)"
export DOTFILES_JQ
export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
mkdir -p "$HOME" "$XDG_STATE_HOME"
unset HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP
PASS=0
FAIL=0
FAIL_DETAILS=()

check() { # $1 label, $2 condition result (0 = pass)
  if [ "$2" = "0" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$1")
  fi
}

user() { printf '{"type":"user","message":{"role":"user","content":"%s"}}\n' "$1"; }
call() { # $1 id, $2 tool, $3 input json
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"%s","name":"%s","input":%s}]}}\n' "$1" "$2" "$3"
}
result() { # $1 id, $2 is_error, $3 text
  printf '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"%s","is_error":%s,"content":"%s"}]}}\n' "$1" "$2" "$3"
}
run_hook() { # $1 transcript file, $2 stop_hook_active
  printf '{"hook_event_name":"Stop","session_id":"s","transcript_path":"%s","stop_hook_active":%s}' "$1" "$2" | bash "$SCRIPT" 2>/dev/null
}

# Fixture: an old-turn failure, then a new turn whose Chrome call failed and was never retried.
T1="$TMP/never-retried.jsonl"
{
  user "old turn"
  call o1 OldTool '{}'
  result o1 true "old failure"
  user "find gifts"
  call a1 mcp__claude-in-chrome__tabs_context_mcp '{}'
  result a1 true "Claude in Chrome is not connected"
  call a2 Read '{"file_path":"/x/notes.md"}'
  result a2 false "ok"
  call a3 Bash '{"command":"git push"}'
  result a3 true "The user doesn't want to proceed with this tool use. The tool use was rejected"
} >"$T1"

OUT="$(run_hook "$T1" false)"
REASON="$(printf '%s' "$OUT" | jq -r '.reason // ""' 2>/dev/null)"
check "Test 1a never retried → block ($OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block"' >/dev/null 2>&1 && echo 0 || echo 1)"
check "Test 1b reason names the tool" "$(case "$REASON" in (*"mcp__claude-in-chrome__tabs_context_mcp"*"Retry"*) echo 0 ;; (*) echo 1 ;; esac)"
check "Test 1c old turn ignored" "$(case "$REASON" in (*OldTool*) echo 1 ;; (*) echo 0 ;; esac)"
check "Test 1d user denial ignored" "$(case "$REASON" in (*"git push"*) echo 1 ;; (*) echo 0 ;; esac)"

# Fixture: failure followed by success of the same tool.
T2="$TMP/retried.jsonl"
{
  user "find gifts"
  call b1 mcp__claude-in-chrome__navigate '{"url":"https://a.example.com"}'
  result b1 false "Error: request timed out"
  call b2 mcp__claude-in-chrome__navigate '{"url":"https://a.example.com"}'
  result b2 false "navigated"
} >"$T2"
OUT="$(run_hook "$T2" false)"
check "Test 2 retried with success → allow ($OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

# Known failure text without is_error still counts.
T3="$TMP/text-fail.jsonl"
{
  user "go"
  call c1 WebFetch '{"url":"https://b.example.com"}'
  result c1 false "Error: request timed out"
} >"$T3"
OUT="$(run_hook "$T3" false)"
check "Test 3 failure text → block ($OUT)" "$(printf '%s' "$OUT" | jq -e '.decision=="block" and (.reason|contains("WebFetch"))' >/dev/null 2>&1 && echo 0 || echo 1)"

OUT="$(run_hook "$T1" true)"
check "Test 4 stop_hook_active → allow ($OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

OUT="$(HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP=1 run_hook "$T1" false)"
check "Test 5 bypass → allow ($OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

T6="$TMP/clean.jsonl"
{
  user "go"
  call d1 Read '{"file_path":"/x"}'
  result d1 false "fine"
} >"$T6"
OUT="$(run_hook "$T6" false)"
check "Test 6 no failures → allow ($OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

OUT="$(run_hook "$TMP/missing.jsonl" false)"
check "Test 7 missing transcript → allow ($OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

echo ""
echo "retry-failed-before-stop.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
