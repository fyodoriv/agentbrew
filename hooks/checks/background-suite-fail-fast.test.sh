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
[ "$FAIL" = 0 ] && echo "background-suite-fail-fast: all passed"
exit $FAIL
