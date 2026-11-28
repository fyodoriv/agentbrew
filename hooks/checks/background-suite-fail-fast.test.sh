#!/bin/bash
# Test fixture for checks/background-suite-fail-fast.sh. Run: bash background-suite-fail-fast.test.sh
set -uo pipefail
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/background-suite-fail-fast.sh"
FAIL=0
check() { # label expected-exit command background
  local input; input=$(jq -nc --arg c "$3" --argjson b "$4" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c,run_in_background:$b}}')
  local got; echo "$input" | bash "$SCRIPT" >/dev/null 2>&1; got=$?
  if [ "$got" != "$2" ]; then echo "FAIL $1: expected $2, got $got"; FAIL=1; fi
}
check "bg pytest blocked" 2 "heavy-run .venv/bin/python -m pytest -q" true
check "bg pytest maxfail ok" 0 "heavy-run .venv/bin/python -m pytest -q --maxfail=50" true
check "bg pytest -x ok" 0 "pytest -q -x tests/" true
check "bg npm test blocked" 2 "npm test" true
check "bg vitest bail ok" 0 "npx vitest run --bail=50" true
check "storm env ok" 0 "REPO_STORM_LIMIT=25 pytest -q" true
check "foreground ok" 0 "pytest -q" false
check "bg non-test ok" 0 "cargo build --release" true
check "pytest-xdist word not matched" 0 "echo pytest-xdist" true

# Full-run CI waits, foreground or background (PR 1373: a job had failed while the agent still waited).
check "pr 1373 run watch blocked" 2 "timeout 1800 gh run watch 46110246456 --repo fyodoriv/agentbrew --interval 60 --exit-status" false
check "bg run watch blocked" 2 "gh run watch 46110246456 --exit-status" true
check "run watch no exit-status blocked" 2 "gh run watch 46110246456" false
check "pr checks watch blocked" 2 "gh pr checks 1373 --repo fyodoriv/agentbrew --watch" true
check "pr checks watch fail-fast blocked" 2 "gh pr checks 1373 --watch --fail-fast" false
check "chained run watch blocked" 2 "cd repo && gh run watch 46110246456 --exit-status" false
check "one-shot pr checks ok" 0 "gh pr checks 1373 --repo fyodoriv/agentbrew --json bucket" false
check "run view ok" 0 "gh run view 46110246456 --log-failed" false
check "watcher ok" 0 "bash ~/.claude/codeassist/hooks-scripts/lib/ci-watch-fail-fast.sh 46110246456 --repo fyodoriv/agentbrew" true
check "watcher rest ok" 0 "bash hooks/lib/ci-watch-fail-fast.sh --rest 1373" false
check "quoted mention ok" 0 "git commit -m 'stop using gh run watch'" false

# The block message names the watcher, its --rest pass, and that the run is not cancelled.
msg=$(jq -nc '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"gh run watch 1 --exit-status"}}' | bash "$SCRIPT" 2>&1 >/dev/null)
for want in 'ci-watch-fail-fast.sh' '--rest' 'never cancels' 'first failed job'; do
  grep -Fq -- "$want" <<<"$msg" || { echo "FAIL: CI block message lacks: $want"; FAIL=1; }
done

# The watcher the block message names has its own fixture; the hook runner only finds checks/*.test.sh.
bash "$(dirname "$SCRIPT")/../lib/ci-watch-fail-fast.test.sh" || FAIL=1

[ "$FAIL" = 0 ] && echo "background-suite-fail-fast: all passed"
exit $FAIL
