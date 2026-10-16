#!/bin/bash
# Test fixture for checks/goal-set-loads-run-goal.sh
#
# Pipes UserPromptSubmit fixture JSON to the hook and asserts the exit code
# and whether stdout carries the run-goal additionalContext.
# Run: `bash goal-set-loads-run-goal.test.sh`.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/goal-set-loads-run-goal.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT
INSTALLED="$FIXTURE_ROOT/installed/run-goal"
MISSING="$FIXTURE_ROOT/missing/run-goal"
mkdir -p "$INSTALLED"
printf -- '---\nname: run-goal\n---\n' >"$INSTALLED/SKILL.md"
export RUN_GOAL_STATE_DIR="$FIXTURE_ROOT/state"

# Usage: check "label" "<prompt>" <expect_context 0|1> [skill_dir] [extra env assignment]
check() {
  local label="$1" prompt="$2" expect_context="$3" skill_dir="${4:-$INSTALLED}" extra_env="${5:-}"
  local input out code has_context
  input="$(jq -cn --arg p "$prompt" '{hook_event_name:"UserPromptSubmit",session_id:"s",prompt:$p}')"
  out="$(printf '%s' "$input" | env RUN_GOAL_SKILL_DIR="$skill_dir" $extra_env bash "$SCRIPT" 2>/dev/null)"
  code=$?
  has_context=0
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | test("run-goal"))' >/dev/null 2>&1; then
    has_context=1
  fi
  if [ "$code" = "0" ] && [ "$has_context" = "$expect_context" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit 0 context=$expect_context, got exit $code context=$has_context")
  fi
}

check "goal with condition adds context" "/goal fix the flaky checkout tests" 1
check "leading whitespace still matches" "   /goal ship the release" 1
check "multi-line condition matches" $'/goal tests pass\nand docs are updated' 1
check "uppercase CLEAR is a clear" "/goal CLEAR" 0
check "bare /goal is a status check" "/goal" 0
check "/goal clear stays silent" "/goal clear" 0
check "/goal stop alias stays silent" "/goal stop" 0
check "/goal cancel with trailing space stays silent" "/goal cancel  " 0
check "plain prompt stays silent" "please fix the goal tests" 0
check "/goals is a different word" "/goals list" 0
check "missing skill stays silent" "/goal fix it" 0 "$MISSING"
check "bypass env stays silent" "/goal fix it" 0 "$INSTALLED" "HOOK_BYPASS_GOAL_SET_LOADS_RUN_GOAL=1"

# The context names run-goal's source when RUN_GOAL_SOURCE_DIR is set.
SRC_OUT="$(jq -cn '{hook_event_name:"UserPromptSubmit",session_id:"s",prompt:"/goal ship"}' | RUN_GOAL_SKILL_DIR="$INSTALLED" RUN_GOAL_SOURCE_DIR=/src/agentbrew/skill-plugins/workflow/run-goal bash "$SCRIPT" 2>/dev/null)"
if printf '%s' "$SRC_OUT" | jq -e '.hookSpecificOutput.additionalContext | test("in scope for every goal") and test("/src/agentbrew/skill-plugins/workflow/run-goal")' >/dev/null 2>&1; then
  PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("context names run-goal source and retro scope"); fi

# Marker lifecycle shared with goal-contract-before-edit.
marker_check() {
  local label="$1" expected="$2"
  local actual=0
  [ -f "$RUN_GOAL_STATE_DIR/s.pending" ] && actual=1
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected marker=$expected, got $actual")
  fi
}
rm -rf "$RUN_GOAL_STATE_DIR"
check "goal set (marker run)" "/goal ship it" 1
marker_check "goal set writes the marker" 1
check "goal clear (marker run)" "/goal clear" 0
marker_check "goal clear removes the marker" 0
check "missing skill (marker run)" "/goal ship it" 0 "$MISSING"
marker_check "no marker without the skill" 0

# Malformed stdin must not block the prompt.
MALFORMED_CODE=$(printf 'not json' | RUN_GOAL_SKILL_DIR="$INSTALLED" bash "$SCRIPT" >/dev/null 2>&1; echo $?)
if [ "$MALFORMED_CODE" = "0" ]; then PASS=$((PASS + 1)); else
  FAIL=$((FAIL + 1)); FAIL_DETAILS+=("malformed stdin: expected exit 0, got $MALFORMED_CODE")
fi

echo "goal-set-loads-run-goal.test.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do echo "  FAIL: $detail"; done
  exit 1
fi
exit 0
