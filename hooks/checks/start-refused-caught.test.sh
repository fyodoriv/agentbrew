#!/bin/bash
# Test fixture for checks/start-refused-caught.sh. Run: bash start-refused-caught.test.sh
set -uo pipefail
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/start-refused-caught.sh"
FAIL=0
check() { # label expected-exit command stdout background
  local input; input=$(jq -nc --arg c "$3" --arg o "$4" --argjson b "$5" '{hook_event_name:"PostToolUse",tool_name:"Bash",tool_input:{command:$c,run_in_background:$b},tool_response:{stdout:$o,stderr:""}}')
  local got; echo "$input" | bash "$SCRIPT" >/dev/null 2>&1; got=$?
  if [ "$got" != "$2" ]; then echo "FAIL $1: expected $2, got $got"; FAIL=1; fi
}
check "lock-held refill caught" 2 "sidequest gifts refill --for dad" '{"state":"running","since":"12:01"} refill started' false
check "already running caught" 2 "scripts/ship.sh" "ship: another run is already running for this branch" false
check "lock held caught" 2 "nohup worker start &" "error: lock held by pid 4121" false
check "bg task refusal caught" 2 "node job.js" "could not acquire lock" true
check "real start ok" 0 "sidequest gifts refill --for dad" '{"state":"started","pid":5512}' false
check "grep of a log ok" 0 "grep -n 'already running' app.log" "12: already running" false
check "non-start ok" 0 "ls -la" "already running" false
[ "$FAIL" = 0 ] && echo "start-refused-caught: all passed"
exit $FAIL
