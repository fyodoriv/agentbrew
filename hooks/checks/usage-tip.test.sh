#!/bin/bash
# Test fixture for checks/usage-tip.sh
#
# Builds fake transcripts, pipes Stop fixture JSON to the hook, and asserts the
# tip it picks and the shown/adopted rows it logs.
# Run: `bash usage-tip.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/usage-tip.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export USAGE_TIPS_DIR="$ROOT/log"
LOG="$USAGE_TIPS_DIR/log.jsonl"

expect() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected $expected, got $actual")
  fi
}
prompt() { jq -cn --arg p "$2" '{type:"user",message:{content:$p}}' >>"$ROOT/$1.jsonl"; }
run() {
  jq -cn --arg s "$1" --arg p "$ROOT/$1.jsonl" '{hook_event_name:"Stop",session_id:$s,transcript_path:$p}' |
    env ${2:-X=1} bash "$SCRIPT" 2>/dev/null
}
tip() { run "$@" | jq -r '.systemMessage // "none"'; }
rows() { grep -c "\"tip\":\"$1\",\"event\":\"$2\"" "$LOG" 2>/dev/null || true; }

prompt s1 "fix it"
expect "short prompt gets done-looks-like" "💡 Say what done looks like: the file, the check to run, the expected result." "$(tip s1)"
expect "shown row logged" 1 "$(rows done-looks-like shown)"

prompt s1 "In src/a.ts the parser drops the last token; run npx vitest run src/a.test.ts and show me it passing, then explain the root cause in one line please."
run s1 >/dev/null
expect "long follow-up prompt counts as adoption" 1 "$(rows done-looks-like adopted)"
expect "adoption logged once" 1 "$(rows done-looks-like adopted)"

prompt s2 "no, that's wrong again"
expect "correction gets clear tip" clear-after-corrections "$(run s2 >/dev/null; tail -n 1 "$LOG" | jq -r .tip)"

prompt s3 "the build fails after your change"
expect "error report without the error gets paste tip" paste-error-verbatim "$(run s3 >/dev/null; tail -n 1 "$LOG" | jq -r .tip)"

prompt s4 "/compact"
first=$(run s4 >/dev/null; tail -n 1 "$LOG" | jq -r .tip)
second=$(run s4 >/dev/null; tail -n 1 "$LOG" | jq -r .tip)
[ "$first" != "$second" ] && expect "no repeat on consecutive stops" 1 1 || expect "no repeat on consecutive stops" "differs" "$first=$second"

expect "bypass prints nothing" "" "$(prompt s5 hi; run s5 HOOK_BYPASS_USAGE_TIP=1)"
expect "stop_hook_active prints nothing" "" "$(jq -cn --arg p "$ROOT/s5.jsonl" '{session_id:"s5",transcript_path:$p,stop_hook_active:true}' | bash "$SCRIPT")"
expect "missing transcript still exits 0" 0 "$(echo '{"session_id":"s6"}' | bash "$SCRIPT" >/dev/null 2>&1; echo $?)"

echo "usage-tip: $PASS passed, $FAIL failed"
for d in "${FAIL_DETAILS[@]:-}"; do [ -n "$d" ] && echo "  FAIL: $d"; done
[ "$FAIL" -eq 0 ]
