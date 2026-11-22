#!/bin/bash
# Test fixture for checks/detached-start-needs-watch.sh. Run: bash detached-start-needs-watch.test.sh
set -uo pipefail
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/detached-start-needs-watch.sh"
FAIL=0
check() { # label expected-exit command background
  local input; input=$(jq -nc --arg c "$3" --argjson b "$4" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c,run_in_background:$b}}')
  local got; echo "$input" | bash "$SCRIPT" >/dev/null 2>&1; got=$?
  if [ "$got" != "$2" ]; then echo "FAIL $1: expected $2, got $got"; FAIL=1; fi
}
check "nohup with no watch blocked" 2 "nohup sidequest gifts refill --for mom > log 2>&1 &" false
check "trailing & blocked" 2 "scripts/ship.sh --title x &" false
check "claude -p & blocked" 2 "claude -p 'refill' >out.txt 2>&1 & echo started" false
check "setsid blocked" 2 "setsid node worker.js" false
check "disown blocked" 2 "node worker.js & disown" false
check "tracked run_in_background ok" 0 "sidequest gifts refill --for mom" true
check "tracked bg nohup ok" 0 "nohup scripts/ship.sh" true
check "detach with kill -0 check ok" 0 "node w.js >l 2>&1 & pid=\$!; sleep 3; kill -0 \$pid && tail -5 l" false
check "detach with wait ok" 0 "a & b & wait" false
check "&& is not a detach" 0 "pnpm install && pnpm build" false
check "2>&1 is not a detach" 0 "make test 2>&1 | tail" false
check "&> is not a detach" 0 "make &> log.txt" false
check "foreground ok" 0 "scripts/ship.sh --title x" false
check "heredoc text is not a detach" 0 "cat > body.md <<'EOF'
\$ nohup sleep 1 > /dev/null 2>&1 &
EOF
gh pr edit 1 --body-file body.md" false
check "quoted text is not a detach" 0 "echo 'run nohup cmd &' && git commit -m \"use & and nohup\"" false
check "detach after a heredoc blocked" 2 "cat > a <<EOF
x
EOF
nohup node w.js &" false
check "detach on a heredoc line blocked" 2 "cat <<'EOF' ; nohup sleep 1 &
x
EOF" false
check "heredoc piped to setsid blocked" 2 "cat <<EOF | setsid foo
x
EOF" false
check "apostrophes in words keep a detach" 2 "echo don't; nohup sleep 100 & echo can't" false
check "apostrophes in comments keep a detach" 2 "git log # it's
sleep 9 & # isn't" false
check "bash -c detach blocked" 2 "bash -c 'nohup sleep 100 &'" false
check "eval detach blocked" 2 "eval \"sleep 100 &\"" false
check "ssh detach blocked" 2 "ssh host 'nohup x &'" false
check "command substitution in quotes blocked" 2 "echo \"started \$(setsid foo &)\"" false
check "backticks in quotes blocked" 2 "x=\"\`nohup a &\`\"" false
check "bash -lc detach blocked" 2 "bash -lc 'sleep 1 &'" false
check "bash --norc -c detach blocked" 2 "bash --norc -c 'sleep 1 &'" false
check "dash -c detach blocked" 2 "dash -c 'sleep 1 &'" false
check "source process substitution blocked" 2 "source <(echo 'sleep 1 &')" false
check "python -c detach blocked" 2 "python3 -c 'import os; os.system(\"sleep 1 &\")'" false
check "ssh and eval words in a message ok" 0 "git commit -m 'fix ssh & eval handling'" false
check "absolute shell path blocked" 2 "/bin/bash -c 'sleep 1 &'" false
check "env prefix blocked" 2 "/usr/bin/env FOO=1 bash -c 'sleep 1 &'" false
check "sudo options blocked" 2 "sudo -u root bash -o pipefail -c 'sleep 1 &'" false
check "then prefix blocked" 2 "if true; then bash -c 'sleep 1 &'; fi" false
check "xargs sh blocked" 2 "echo x | xargs sh -c 'sleep 1 &'" false
check "pipe into bash blocked" 2 "echo 'sleep 1 &' | bash" false
check "heredoc into sh blocked" 2 "sh <<'EOF'
nohup x &
EOF" false
check "awk system blocked" 2 "awk 'BEGIN{system(\"sleep 1 &\")}'" false
check "tmux blocked" 2 "tmux new-session -d 'sleep 100 &'" false
[ "$FAIL" = 0 ] && echo "detached-start-needs-watch: all passed"
exit $FAIL
