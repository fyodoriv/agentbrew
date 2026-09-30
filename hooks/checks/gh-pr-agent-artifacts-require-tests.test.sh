#!/bin/bash

set -euo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-agent-artifacts-require-tests.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()
TMP_DIRS=()
LAST_TMP=""
LAST_EXIT=0
LAST_STDERR=""

cleanup() {
  local tmp
  for tmp in "${TMP_DIRS[@]:-}"; do
    rm -rf "$tmp"
  done
}
trap cleanup EXIT

make_tmp() {
  LAST_TMP="$(mktemp -d)"
  TMP_DIRS+=("$LAST_TMP")
}

assert_exit_code() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $actual")
  fi
}

assert_stderr_contains() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if printf '%s' "$actual" | grep -q "$expected"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: stderr did not contain $expected")
  fi
}

commit_all() {
  local repo="$1"
  local message="${2:-fixture}"
  git -C "$repo" add .
  LEFTHOOK=0 git -C "$repo" -c user.name="Hook Test" -c user.email="hook-test@example.com" commit -m "chore: $message PROJ-123" >/dev/null
}

new_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null
  echo base >"$repo/README.md"
  commit_all "$repo" "seed"
  git -C "$repo" switch -c feature >/dev/null 2>&1
}

run_hook() {
  local repo="$1"
  local command="$2"
  local stderr_file="$repo/stderr.txt"
  local stdout_file="$repo/stdout.txt"
  local input
  mkdir -p "$repo/home"
  input="$(jq -n --arg command "$command" --arg cwd "$repo" '{session_id:"test-session", transcript_path:"/tmp/gh-pr-agent-artifacts-require-tests.jsonl", hook_event_name:"PreToolUse", tool_name:"Bash", cwd:$cwd, tool_input:{command:$command}}')"
  set +e
  printf '%s' "$input" | HOME="$repo/home" bash "$SCRIPT" >"$stdout_file" 2>"$stderr_file"
  LAST_EXIT=$?
  set -e
  LAST_STDERR="$(cat "$stderr_file")"
}

body() {
  cat <<'EOF_BODY'
## Summary

Change agent artifacts because PROJ-123 requires coverage.
EOF_BODY
}

run_case() {
  local label="$1"
  local expected="$2"
  local setup_name="$3"
  make_tmp
  local repo="$LAST_TMP/repo"
  new_repo "$repo"
  "$setup_name" "$repo"
  commit_all "$repo" "fixture"
  run_hook "$repo" "gh pr create --body \"$(body)\""
  assert_exit_code "$label" "$expected" "$LAST_EXIT"
}

setup_changed_command_without_test() {
  mkdir -p "$1/commands"
  echo 'Run deployment.' >"$1/commands/deploy.md"
}

setup_changed_command_with_eval() {
  setup_changed_command_without_test "$1"
  mkdir -p "$1/agent-artifact-evals"
  echo 'cases: []' >"$1/agent-artifact-evals/deploy.yaml"
}

setup_changed_agents_template_with_test() {
  mkdir -p "$1/templates" "$1/src/sync"
  echo 'Agent rules.' >"$1/templates/AGENTS.md"
  echo 'import { it } from "vitest"; it("renders", () => {});' >"$1/src/sync/instructions-content.test.ts"
}

setup_changed_hook_without_fixture() {
  mkdir -p "$1/hooks/checks"
  echo '#!/bin/bash' >"$1/hooks/checks/custom-guard.sh"
}

setup_changed_agentfile_with_static_test() {
  mkdir -p "$1/src"
  printf 'mcp:\n  - name: demo\n    command: node\n' >"$1/Agentfile.yaml"
  echo 'import { it } from "vitest"; it("parses", () => {});' >"$1/src/agentfile.test.ts"
}

setup_docs_only() {
  mkdir -p "$1/docs"
  echo 'Notes.' >"$1/docs/notes.md"
}

setup_changed_agentfile_without_test() {
  printf 'mcp:\n  - name: demo\n    command: node\n' >"$1/Agentfile.yaml"
}

run_case "changed command without test blocks" 2 setup_changed_command_without_test
assert_stderr_contains "changed command lists path" "commands/deploy.md" "$LAST_STDERR"

run_case "changed command with eval passes" 0 setup_changed_command_with_eval
run_case "changed AGENTS template with sync test passes" 0 setup_changed_agents_template_with_test
run_case "changed hook without fixture blocks" 2 setup_changed_hook_without_fixture
assert_stderr_contains "changed hook lists path" "hooks/checks/custom-guard.sh" "$LAST_STDERR"
run_case "changed Agentfile with static test passes" 0 setup_changed_agentfile_with_static_test
run_case "docs-only unrelated PR bypasses" 0 setup_docs_only

make_tmp
repo="$LAST_TMP/repo"
new_repo "$repo"
setup_changed_agentfile_without_test "$repo"
commit_all "$repo" "exemption"
run_hook "$repo" "gh pr create --body \"$(body)

Agent artifact test exemption: migration is covered by manual runbook\""
assert_exit_code "explicit exemption allows" 0 "$LAST_EXIT"
assert_stderr_contains "explicit exemption warns" "Agent artifact test exemption accepted" "$LAST_STDERR"

make_tmp
repo="$LAST_TMP/repo"
new_repo "$repo"
setup_changed_agentfile_without_test "$repo"
commit_all "$repo" "bypass"
input="$(jq -n --arg command "gh pr create --body \"$(body)\"" --arg cwd "$repo" '{session_id:"test-session", transcript_path:"/tmp/gh-pr-agent-artifacts-require-tests.jsonl", hook_event_name:"PreToolUse", tool_name:"Bash", cwd:$cwd, tool_input:{command:$command}}')"
set +e
printf '%s' "$input" | HOOK_BYPASS_GH_PR_AGENT_ARTIFACTS_REQUIRE_TESTS=1 HOME="$repo/home" bash "$SCRIPT" >"$repo/bypass.out" 2>"$repo/bypass.err"
bypass_exit=$?
set -e
assert_exit_code "bypass env allows" 0 "$bypass_exit"
assert_stderr_contains "bypass env asks for follow-up" "File a P0 follow-up task" "$(cat "$repo/bypass.err")"

echo ""
echo "gh-pr-agent-artifacts-require-tests.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
