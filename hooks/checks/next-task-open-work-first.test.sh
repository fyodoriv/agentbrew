#!/bin/bash
# Test fixture for checks/next-task-open-work-first.sh
#
# Pipes UserPromptSubmit fixture JSON to the hook, with the real wrap-up
# open-work.sh, and asserts whether stdout carries the open-work context.
# Run: `bash next-task-open-work-first.test.sh`.

set -uo pipefail

HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")"
SCRIPT="$HERE/next-task-open-work-first.sh"
SKILL="$(cd "$HERE/../.." && pwd)/skill-plugins/workflow/wrap-up"
PASS=0
FAIL=0
FAIL_DETAILS=()

FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export OPEN_WORK_NO_GH=1

# A clean clone, and one with an unmerged branch.
git init -q --bare -b main "$FIXTURE_ROOT/remote.git"
git clone -q "$FIXTURE_ROOT/remote.git" "$FIXTURE_ROOT/clean" 2>/dev/null
(cd "$FIXTURE_ROOT/clean" && git checkout -q -b main && echo a >a && git add a && git commit -qm init && git push -q -u origin main && git remote set-head origin main)
git clone -q "$FIXTURE_ROOT/remote.git" "$FIXTURE_ROOT/busy"
(cd "$FIXTURE_ROOT/busy" && git checkout -q -b feat/wip && echo b >b && git add b && git commit -qm "feat: b")
NOT_INSTALLED="$FIXTURE_ROOT/missing"

# Usage: check "label" "<prompt>" <cwd> <expect_context 0|1> [skill_dir]
check() {
  local label="$1" prompt="$2" cwd="$3" expect_context="$4" skill_dir="${5:-$SKILL}"
  local input out code has_context
  input="$(jq -cn --arg p "$prompt" --arg c "$cwd" '{hook_event_name:"UserPromptSubmit",session_id:"s",cwd:$c,prompt:$p}')"
  out="$(printf '%s' "$input" | WRAP_UP_SKILL_DIR="$skill_dir" bash "$SCRIPT" 2>/dev/null)"
  code=$?
  has_context=0
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | test("feat/wip") and test("Continue it first"))' >/dev/null 2>&1; then
    has_context=1
  fi
  if [ "$code" = "0" ] && [ "$has_context" = "$expect_context" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit 0 context=$expect_context, got exit $code context=$has_context")
  fi
}

check "/next-task with an unmerged branch adds context" "/next-task" "$FIXTURE_ROOT/busy" 1
check "/next-task with an argument adds context" "/next-task P1" "$FIXTURE_ROOT/busy" 1
check "plain 'next task' adds context" "  Next task please" "$FIXTURE_ROOT/busy" 1
check "clean repo stays silent" "/next-task" "$FIXTURE_ROOT/clean" 0
check "other prompt stays silent" "fix the next-task docs" "$FIXTURE_ROOT/busy" 0
check "skill not installed stays silent" "/next-task" "$FIXTURE_ROOT/busy" 0 "$NOT_INSTALLED"
check "not a git checkout stays silent" "/next-task" "$FIXTURE_ROOT" 0
out="$(printf '{"prompt":"/next-task","cwd":"%s"}' "$FIXTURE_ROOT/busy" | HOOK_BYPASS_NEXT_TASK_OPEN_WORK_FIRST=1 WRAP_UP_SKILL_DIR="$SKILL" bash "$SCRIPT" 2>/dev/null)"
if [ "$?" = 0 ] && ! printf '%s' "$out" | grep -q additionalContext; then PASS=$((PASS + 1)); else
  FAIL=$((FAIL + 1)); FAIL_DETAILS+=("bypass: expected silence"); fi

echo ""
echo "next-task-open-work-first.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
