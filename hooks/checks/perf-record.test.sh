#!/bin/bash
# Test fixture for checks/perf-record.sh
#
# The hook appends one row per tool call to the perf log and never blocks.
# The payloads copy the shape that Claude Code 2.1.301 sends (captured with
# a logging hook in a scratch session), with ids and paths replaced.
# Run: `bash perf-record.test.sh`

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/perf-record.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XDG_STATE_HOME="$TMP/state"
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

log_file() { ls "$XDG_STATE_HOME"/agentbrew/perf/*.jsonl 2>/dev/null | head -1; }
last_row() { tail -1 "$(log_file)"; }
run_hook() { printf '%s' "$1" | /bin/bash "$SCRIPT" >"$TMP/out" 2>&1; echo $?; }
bash_payload() { # $1 command
  jq -nc --arg c "$1" --arg cwd "$REPO" '{hook_event_name:"PostToolUse",session_id:"s1",cwd:$cwd,tool_name:"Bash",tool_input:{command:$c},duration_ms:5}'
}

REPO="$TMP/work/myrepo"
mkdir -p "$REPO/.git" "$REPO/src"
WT="$TMP/wt/feature-x"
mkdir -p "$WT"
printf 'gitdir: %s/.git/worktrees/feature-x\n' "$REPO" >"$WT/.git"

POST_TOOL_USE='{"session_id":"11111111-2222-3333-4444-555555555555","transcript_path":"/redacted/transcript.jsonl","cwd":"'"$REPO/src"'","prompt_id":"redacted","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"sleep 1 && echo hi","description":"Sleep one second then echo hi"},"tool_response":{"stdout":"hi","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"tool_use_id":"toolu_redacted","duration_ms":1163}'
POST_TOOL_FAILURE='{"session_id":"11111111-2222-3333-4444-555555555555","transcript_path":"/redacted/transcript.jsonl","cwd":"'"$WT"'","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"ls /nonexistent-dir-xyz","description":"List"},"tool_use_id":"toolu_redacted","error":"Exit code 1","is_interrupt":false,"duration_ms":24}'
PRE_TOOL_USE='{"session_id":"11111111-2222-3333-4444-555555555555","transcript_path":"/redacted/transcript.jsonl","cwd":"'"$REPO/src"'","scratchpad_dir":"/redacted/scratchpad","prompt_id":"redacted","permission_mode":"auto","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"GH_TOKEN=ghp_FAKEexampleTOKEN1234567890abcd cd /srv/team-x && git push --force origin HEAD:main","description":"Force-push HEAD to origin main"},"tool_use_id":"toolu_01AttemptExample"}'
PERMISSION_DENIED='{"session_id":"11111111-2222-3333-4444-555555555555","transcript_path":"/redacted/transcript.jsonl","cwd":"'"$REPO/src"'","scratchpad_dir":"/redacted/scratchpad","prompt_id":"redacted","permission_mode":"auto","effort":{"level":"medium"},"hook_event_name":"PermissionDenied","tool_name":"Bash","tool_input":{"command":"GH_TOKEN=ghp_FAKEexampleTOKEN1234567890abcd cd /srv/team-x && git push --force origin HEAD:main","description":"Force-push HEAD to origin main"},"tool_use_id":"toolu_01AttemptExample","reason":"The server-side auto mode classifier judged this action dangerous (it gave no explanation)"}'
USER_PROMPT='{"session_id":"11111111-2222-3333-4444-555555555555","cwd":"'"$REPO"'","hook_event_name":"UserPromptSubmit","prompt":"secret plan for the launch"}'

# Test 1: PostToolUse → exit 0, no output, one row with the key and duration.
RC=$(run_hook "$POST_TOOL_USE")
check "Test 1a (exit 0)" "$([ "$RC" = 0 ] && echo 0 || echo 1)"
check "Test 1b (prints nothing)" "$([ ! -s "$TMP/out" ] && echo 0 || echo 1)"
ROW="$(last_row)"
check "Test 1c (row fields: $ROW)" "$(printf '%s' "$ROW" | jq -e '.project=="myrepo" and .tool=="Bash" and .ms==1163 and .ok==true and .key=="sleep 1" and .id=="toolu_redacted" and .agent==null and .sid=="11111111-2222-3333-4444-555555555555" and (.ts|test("^[0-9]{4}-"))' >/dev/null && echo 0 || echo 1)"
check "Test 1d (file named YYYY-MM.jsonl)" "$(basename "$(log_file)" | grep -Eq '^[0-9]{4}-[0-9]{2}\.jsonl$' && echo 0 || echo 1)"

# Test 2: PostToolUseFailure in a linked worktree → ok false, project = main repo.
run_hook "$POST_TOOL_FAILURE" >/dev/null
ROW="$(last_row)"
check "Test 2 (failure row in worktree: $ROW)" "$(printf '%s' "$ROW" | jq -e '.ok==false and .project=="myrepo" and .key=="ls <path>" and .ms==24' >/dev/null && echo 0 || echo 1)"

# Test 3: UserPromptSubmit → a turn row without the prompt text.
run_hook "$USER_PROMPT" >/dev/null
ROW="$(last_row)"
check "Test 3a (turn row: $ROW)" "$(printf '%s' "$ROW" | jq -e '.ev=="turn" and .project=="myrepo" and (has("key")|not)' >/dev/null && echo 0 || echo 1)"
check "Test 3b (no prompt text in log)" "$(grep -q 'secret plan' "$(log_file)" && echo 1 || echo 0)"

# Test 4: privacy — a token-like argument, a path, and env values never reach the log.
TOKEN="ghp_FAKEexampleTOKEN1234567890abcd"
run_hook "$(bash_payload "GH_TOKEN=$TOKEN cd $REPO && env -u DOTFILES_DIR npm run verify -- --token=$TOKEN")" >/dev/null
check "Test 4a (key is npm run verify: $(last_row))" "$(last_row | jq -e '.key=="npm run verify"' >/dev/null && echo 0 || echo 1)"
run_hook "$(bash_payload "curl -H \"Authorization: Bearer $TOKEN\" https://example.com")" >/dev/null
run_hook "$(bash_payload "deploy $TOKEN")" >/dev/null
check "Test 4b (deploy token redacted: $(last_row))" "$(last_row | jq -e '.key=="deploy <redacted>"' >/dev/null && echo 0 || echo 1)"
run_hook "$(jq -nc --arg cwd "$REPO" '{hook_event_name:"PostToolUse",session_id:"s1",cwd:$cwd,tool_name:"Edit",tool_input:{file_path:"/srv/team-x/private/launch-plan.TS",old_string:"a",new_string:"b"},duration_ms:3}')" >/dev/null
check "Test 4c (Edit key is Edit:ts)" "$(last_row | jq -e '.key=="Edit:ts"' >/dev/null && echo 0 || echo 1)"
check "Test 4d (token absent from log)" "$(grep -q "$TOKEN" "$(log_file)" && echo 1 || echo 0)"
check "Test 4e (paths absent from log)" "$(grep -Eq "$TMP|launch-plan|/srv/team-x" "$(log_file)" && echo 1 || echo 0)"

# Test 5: wrappers and a script path keep only the useful words.
run_hook "$(bash_payload "(cd $REPO && make check)")" >/dev/null
check "Test 5a (subshell cd → make check)" "$(last_row | jq -e '.key=="make check"' >/dev/null && echo 0 || echo 1)"
run_hook "$(bash_payload "node $REPO/scripts/agent-perf.mjs report --all")" >/dev/null
check "Test 5b (script path → file name)" "$(last_row | jq -e '.key=="node agent-perf.mjs"' >/dev/null && echo 0 || echo 1)"

# Test 6: Agent and Skill keys; a subagent row carries agent_type.
run_hook "$(jq -nc --arg cwd "$REPO" '{hook_event_name:"PostToolUse",session_id:"s1",cwd:$cwd,tool_name:"Agent",agent_type:"Explore",tool_input:{subagent_type:"Explore",prompt:"find the secret"},duration_ms:9}')" >/dev/null
check "Test 6a (agent key)" "$(last_row | jq -e '.key=="agent:Explore" and .agent=="Explore"' >/dev/null && echo 0 || echo 1)"
run_hook "$(jq -nc --arg cwd "$REPO" '{hook_event_name:"PostToolUse",session_id:"s1",cwd:$cwd,tool_name:"Skill",tool_input:{skill:"ship-it",args:"x"},duration_ms:9}')" >/dev/null
check "Test 6b (skill key)" "$(last_row | jq -e '.key=="skill:ship-it"' >/dev/null && echo 0 || echo 1)"

# Test 7: other events and broken input → exit 0 and no new row.
BEFORE=$(wc -l <"$(log_file)")
RC1=$(run_hook '{"hook_event_name":"Stop","session_id":"s1"}')
RC2=$(run_hook 'not json')
AFTER=$(wc -l <"$(log_file)")
check "Test 7 (ignored events exit 0, no row)" "$([ "$RC1" = 0 ] && [ "$RC2" = 0 ] && [ "$BEFORE" = "$AFTER" ] && echo 0 || echo 1)"

# Test 8: bypass → exit 0 and no row.
BEFORE=$(wc -l <"$(log_file)")
printf '%s' "$POST_TOOL_USE" | HOOK_BYPASS_PERF_RECORD=1 /bin/bash "$SCRIPT" >/dev/null 2>&1
RC=$?
AFTER=$(wc -l <"$(log_file)")
check "Test 8 (bypass)" "$([ "$RC" = 0 ] && [ "$BEFORE" = "$AFTER" ] && echo 0 || echo 1)"

# Test 9: an unwritable state dir never fails the tool.
RC=$(printf '%s' "$POST_TOOL_USE" | XDG_STATE_HOME=/dev/null/nope /bin/bash "$SCRIPT" >/dev/null 2>&1; echo $?)
check "Test 9 (unwritable state dir → exit 0)" "$([ "$RC" = 0 ] && echo 0 || echo 1)"

# Test 10: PreToolUse → an attempt row with the call id, no duration, no ok.
run_hook "$PRE_TOOL_USE" >/dev/null
ROW="$(last_row)"
check "Test 10a (attempt row: $ROW)" "$(printf '%s' "$ROW" | jq -e '(keys_unsorted == ["project","ts","sid","ev","tool","key","id","agent"]) and .ev=="attempt" and .project=="myrepo" and .tool=="Bash" and .key=="git push" and .id=="toolu_01AttemptExample" and .agent==null' >/dev/null && echo 0 || echo 1)"

# Test 11: PermissionDenied → a denied row with the same id; the reason text is not stored.
run_hook "$PERMISSION_DENIED" >/dev/null
ROW="$(last_row)"
check "Test 11a (denied row: $ROW)" "$(printf '%s' "$ROW" | jq -e '.ev=="denied" and .key=="git push" and .id=="toolu_01AttemptExample" and (has("ms")|not)' >/dev/null && echo 0 || echo 1)"
check "Test 11b (no token, path, or reason text in log)" "$(grep -Eq 'ghp_FAKE|/srv/team-x|classifier|Force-push' "$(log_file)" && echo 1 || echo 0)"

# Test 12: an id with unsafe characters keeps only [A-Za-z0-9_-].
run_hook "$(jq -nc --arg cwd "$REPO" '{hook_event_name:"PreToolUse",session_id:"s1",cwd:$cwd,tool_name:"Read",tool_input:{file_path:"/a/b.md"},tool_use_id:"toolu_\"x/../y"}')" >/dev/null
check "Test 12 (id sanitized: $(last_row))" "$(last_row | jq -e '.id=="toolu_xy" and .key=="Read:md"' >/dev/null && echo 0 || echo 1)"

# Test 13: a multi-line command keys its slowest line, not its first.
# A multi-line printf hid "npm ci; npm run verify" behind "git fetch".
MULTI=$'cd w && git fetch -q origin && printf \'feat: x\n\nbody line\n\' > m.txt && git commit -qF m.txt; npm ci --silent; npm run verify > v.log'
run_hook "$(bash_payload "$MULTI")" >/dev/null
check "Test 13a (multi-line printf → npm ci: $(last_row))" "$(last_row | jq -e '.key=="npm ci"' >/dev/null && echo 0 || echo 1)"
# A heredoc body is data: "make deploy" inside it is not a command.
HEREDOC=$'cat > notes.md <<\'EOF\'\nmake deploy\nEOF\ngit fetch -q origin\nnpm run verify'
run_hook "$(bash_payload "$HEREDOC")" >/dev/null
check "Test 13b (heredoc body skipped → npm run verify: $(last_row))" "$(last_row | jq -e '.key=="npm run verify"' >/dev/null && echo 0 || echo 1)"
# Plain lines on their own lines still key like a ";" chain.
LINES=$'git fetch -q origin\ngit status'
run_hook "$(bash_payload "$LINES")" >/dev/null
check "Test 13c (newline is a separator → git status: $(last_row))" "$(last_row | jq -e '.key=="git status"' >/dev/null && echo 0 || echo 1)"

echo ""
echo "perf-record.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  ✗ $detail"; done
  exit 1
fi
exit 0
