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

# Never repeat: every eligible tip shows once before any tip comes back, then oldest-first.
export USAGE_TIPS_DIR="$ROOT/norepeat"
LOG="$USAGE_TIPS_DIR/log.jsonl"
printf 's\tshort\t-\tTip S.\na\tany\t-\tTip A.\nb\tany\t-\tTip B.\nc\tany\t-\tTip C.\n' >"$ROOT/three.tsv"
seq_tips=""
for sess in n1 n2 n3 n4 n5 n6 n7 n8; do
  prompt "$sess" "fix it"
  run "$sess" "USAGE_TIPS_FILE=$ROOT/three.tsv" >/dev/null
  seq_tips="$seq_tips$(tail -n 1 "$LOG" | jq -r .tip)"
done
expect "each tip once across sessions, then oldest-first" sabcsabc "$seq_tips"
expect "shown row carries the tip text" "Tip C." "$(tail -n 1 "$LOG" | jq -r .text)"
prompt n9 "/status"
run n9 "USAGE_TIPS_FILE=$ROOT/three.tsv" >/dev/null; run n9 "USAGE_TIPS_FILE=$ROOT/three.tsv" >/dev/null
expect "rotation continues within a session" ab "$(tail -n 2 "$LOG" | jq -r .tip | tr -d '\n')"

# Real transcript format: slash commands and ! lines are stored as tags.
export USAGE_TIPS_DIR="$ROOT/tags"
LOG="$USAGE_TIPS_DIR/log.jsonl"
printf 'm\tany\t^/memory( |$)\tTip M.\nb\tany\t^!git\tTip B.\nz\tany\t-\tTip Z.\n' >"$ROOT/tags.tsv"
prompt t1 "/status"
run t1 "USAGE_TIPS_FILE=$ROOT/tags.tsv" >/dev/null
run t1 "USAGE_TIPS_FILE=$ROOT/tags.tsv" >/dev/null
prompt t1 $'<command-name>/memory</command-name>\n            <command-message>memory</command-message>\n            <command-args></command-args>'
prompt t1 "<local-command-stdout>Opened memory file</local-command-stdout>"
prompt t1 "<bash-input>git status</bash-input><bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>"
run t1 "USAGE_TIPS_FILE=$ROOT/tags.tsv" >/dev/null
expect "a ! line in tag form counts as adoption" 1 "$(rows b adopted)"
prompt t1 $'<command-name>/memory</command-name>\n<command-args>edit</command-args>'
run t1 "USAGE_TIPS_FILE=$ROOT/tags.tsv" >/dev/null
expect "a slash command in tag form counts as adoption" 1 "$(rows m adopted)"
prompt t2 "/status"
run t2 "USAGE_TIPS_FILE=$ROOT/tags.tsv" >/dev/null
expect "a tip adopted in another session never shows again" z "$(tail -n 1 "$LOG" | jq -r .tip)"

# Catalog shape: 4 fields, unique ids, known trigger, compiling adopt regex, text under 100 chars.
TIPS_FILE="$(dirname "$SCRIPT")/../lib/usage-tips.tsv"
bad=0; ids=""
while IFS=$'\t' read -r id trigger adopt text extra; do
  case "$id" in '#'*|'') continue ;; esac
  case "$trigger" in short|correction|long|error|any) ;; *) bad=$((bad + 1)) ;; esac
  [ -n "$text" ] && [ -z "$extra" ] && [ "${#text}" -lt 100 ] || bad=$((bad + 1))
  if [ "$adopt" != "-" ]; then echo x | grep -qE -- "$adopt"; [ $? -le 1 ] || bad=$((bad + 1)); fi
  ids="$ids$id"$'\n'
done <"$TIPS_FILE"
expect "catalog rows are well formed" 0 "$bad"
expect "catalog ids are unique" "" "$(printf '%s' "$ids" | sort | uniq -d)"
expect "catalog has at least 25 tips" 1 "$([ "$(printf '%s' "$ids" | grep -c .)" -ge 25 ] && echo 1 || echo 0)"

echo "usage-tip: $PASS passed, $FAIL failed"
for d in "${FAIL_DETAILS[@]:-}"; do [ -n "$d" ] && echo "  FAIL: $d"; done
[ "$FAIL" -eq 0 ]
