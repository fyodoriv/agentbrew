#!/bin/bash
# Test fixture for checks/poll-loop-hint.sh
#
# Advisory hook: every case exits 0. A loop with `sleep` must print the hint
# as PreToolUse additionalContext on stdout; every other case prints nothing.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/poll-loop-hint.sh"
HOOK_DECISIONS_LOG="${HOOK_DECISIONS_LOG:-$(mktemp "${TMPDIR:-/tmp}/poll-loop-hint-log.XXXXXX")}"
export HOOK_DECISIONS_LOG
PASS=0
FAIL=0
FAIL_DETAILS=()

# run_case <label> <expect: hint|silent> <command> [run_in_background]
run_case() {
  local label="$1" expect="$2" cmd="$3" bg="${4:-false}" out rc=0
  out="$(jq -nc --arg cmd "$cmd" --argjson bg "$bg" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd,run_in_background:$bg}}' |
    bash "$SCRIPT" 2>/dev/null)" || rc=$?
  if [ "$rc" != 0 ]; then
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected exit 0, got $rc"); return
  fi
  if [ "$expect" = hint ]; then
    if printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"
        and (.hookSpecificOutput.additionalContext | test("run_in_background") and test("gh pr checks --watch") and test("wait <pid>") and test("poll interval"))
        and (.hookSpecificOutput | has("permissionDecision") | not)' >/dev/null 2>&1; then
      PASS=$((PASS + 1))
    else
      FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected hint JSON, got '$out'")
    fi
  else
    if [ -z "$out" ]; then PASS=$((PASS + 1)); else
      FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected silence, got '$out'"); fi
  fi
}

# Loops that poll with sleep → hint.
run_case "until loop with sleep" hint 'until gh pr view 5 --json state | grep -q MERGED; do sleep 10; done'
run_case "while loop with sleep" hint 'while ! curl -sf localhost:3000; do sleep 2; done; echo up'
run_case "multi-line loop after cd" hint $'cd ~/x && until tail -3 log | grep -E "done|fail"; do\n  sleep 30\ndone'
run_case "while true with sleep later in body" hint 'while true; do test -f out.txt && break; echo waiting; sleep 5; done'

# Loops without sleep → silent.
run_case "plain until without sleep" silent 'until make build; do git pull; done'
run_case "while read loop" silent 'git branch | while read -r b; do echo "$b"; done'
run_case "sleep with no loop" silent 'sleep 5 && echo hi'

# Loop words that are only text → silent.
run_case "loop inside double quotes" silent 'echo "until x; do sleep 1; done"'
run_case "loop inside single quotes" silent "printf '%s\\n' 'while true; do sleep 1; done'"
run_case "loop inside a heredoc body" silent $'cat > notes.md <<\'EOF\'\nuntil ready; do sleep 5; done\nEOF\necho saved'
run_case "loop inside a dash heredoc" silent $'cat <<-EOF\n\twhile true; do sleep 1; done\n\tEOF'
run_case "loop in a comment" silent 'ls # until x; do sleep 1; done'
run_case "words as arguments" silent 'grep -n "until" file.txt; echo while sleep'

# Already backgrounded: the agent gets a completion notice → silent.
run_case "loop with run_in_background" silent 'until test -f done.flag; do sleep 5; done' true

# Non-Bash tool → silent.
out="$(printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/a.sh","content":"until x; do sleep 1; done"}}' | bash "$SCRIPT" 2>/dev/null)"; rc=$?
if [ "$rc" = 0 ] && [ -z "$out" ]; then PASS=$((PASS + 1)); else
  FAIL=$((FAIL + 1)); FAIL_DETAILS+=("non-Bash tool: rc=$rc out='$out'"); fi

# Bypass env var → silent even on a real poll loop.
out="$(jq -nc --arg cmd 'until x; do sleep 1; done' '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd}}' |
  HOOK_BYPASS_POLL_LOOP_HINT=1 bash "$SCRIPT" 2>/dev/null)"; rc=$?
if [ "$rc" = 0 ] && [ -z "$out" ]; then PASS=$((PASS + 1)); else
  FAIL=$((FAIL + 1)); FAIL_DETAILS+=("bypass env var: rc=$rc out='$out'"); fi

echo ""
echo "poll-loop-hint.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
