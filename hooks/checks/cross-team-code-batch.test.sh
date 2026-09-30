#!/bin/bash
# Test fixture for checks/cross-team-code-batch.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code (+ stderr for the warn case). Run:
# `bash cross-team-code-batch.test.sh` (assumes you're in agentbrew/hooks/checks/).
#
# Verdict contract (verdict.sh): this hook calls verdict_warn → exit 0
# (block-by-default risk too high — CODEOWNERS parsing has edge cases).
# Every path exits 0; the violation case additionally asserts the warn
# message reached stderr, proving the verdict path genuinely fired.
#
# The hook needs real repo state: it runs `git diff --name-only HEAD`
# against the cwd, maps changed files to CODEOWNERS owners, and warns
# when 2+ teams are touched without a [BATCH]/[CROSS-TEAM] title. So the
# git-dependent cases build hermetic throwaway repos with mktemp (same
# pattern as gh-pr-skill-requires-evals.test.sh) and run the hook from
# inside them. core.hooksPath/LEFTHOOK are neutralised so the fixture's
# seed commit is independent of the developer's global git hooks.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/cross-team-code-batch.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()
TMP_DIRS=()

cleanup() {
  local d
  for d in "${TMP_DIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
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
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -q "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: stderr did not contain '$needle'")
  fi
}

assert_no_warn() {
  local label="$1"
  local haystack="$2"
  if printf '%s' "$haystack" | grep -q "WARN"; then
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: unexpectedly warned")
  else
    PASS=$((PASS + 1))
  fi
}

# Seed a git repo with exact-path CODEOWNERS entries (no globs, so the
# hook's owner-matching grep maps each changed file to one team), commit
# it, then dirty the tracked files so `git diff --name-only HEAD` lists them.
seed_repo() {
  local repo="$1"
  git -C "$repo" init -b main >/dev/null 2>&1
  git -C "$repo" add . >/dev/null 2>&1
  LEFTHOOK=0 git -C "$repo" -c core.hooksPath=/dev/null \
    -c user.name="Hook Test" -c user.email="hook-test@example.com" \
    commit -m "chore: seed PROJ-123" >/dev/null 2>&1
}

make_two_team_repo() {
  local repo="$1"
  mkdir -p "$repo/teamA" "$repo/teamB"
  printf 'teamA/file1 @org/team-a\nteamB/file2 @org/team-b\n' >"$repo/CODEOWNERS"
  echo a >"$repo/teamA/file1"
  echo b >"$repo/teamB/file2"
  seed_repo "$repo"
  echo a2 >>"$repo/teamA/file1"
  echo b2 >>"$repo/teamB/file2"
}

make_one_team_repo() {
  local repo="$1"
  mkdir -p "$repo/teamA"
  printf 'teamA/file1 @org/team-a\nteamA/file2 @org/team-a\n' >"$repo/CODEOWNERS"
  echo a >"$repo/teamA/file1"
  echo b >"$repo/teamA/file2"
  seed_repo "$repo"
  echo a2 >>"$repo/teamA/file1"
  echo b2 >>"$repo/teamA/file2"
}

# Run the hook from inside $repo (it resolves the repo via the process
# cwd, not a JSON field). Sets LAST_EXIT and LAST_STDERR.
run_hook_cwd() {
  local repo="$1"
  local command="$2"
  local input out
  input="$(jq -n --arg command "$command" '{hook_event_name:"PreToolUse", tool_name:"Bash", tool_input:{command:$command}}')"
  out="$( cd "$repo" && printf '%s' "$input" | bash "$SCRIPT" 2>"$repo/.hookerr"; echo $? )"
  LAST_EXIT="$(printf '%s\n' "$out" | tail -1)"
  LAST_STDERR="$(cat "$repo/.hookerr" 2>/dev/null || true)"
}

# Test 1: 2-team diff, no [BATCH] prefix → warn (exit 0 + stderr)
make_tmp
make_two_team_repo "$LAST_TMP"
run_hook_cwd "$LAST_TMP" 'gh pr create --title "fix release banner"'
assert_exit_code "Test 1 (2 teams, no prefix) exit" 0 "$LAST_EXIT"
assert_stderr_contains "Test 1 (2 teams, no prefix) warn fired" "Cross-Team Code Touches Batch" "$LAST_STDERR"

# Test 2: 2-team diff, but title has [BATCH] prefix → bypass (compliant), no warn
make_tmp
make_two_team_repo "$LAST_TMP"
run_hook_cwd "$LAST_TMP" 'gh pr create --title "[BATCH] cross-team release banner"'
assert_exit_code "Test 2 ([BATCH] prefix) exit" 0 "$LAST_EXIT"
assert_no_warn "Test 2 ([BATCH] prefix)" "$LAST_STDERR"

# Test 3: single-team diff → allow, no warn
make_tmp
make_one_team_repo "$LAST_TMP"
run_hook_cwd "$LAST_TMP" 'gh pr create --title "fix release banner"'
assert_exit_code "Test 3 (single team) exit" 0 "$LAST_EXIT"
assert_no_warn "Test 3 (single team)" "$LAST_STDERR"

# Test 4: non-Bash tool → bypass (before any git/CODEOWNERS work)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo.ts","content":"export const foo = 1;"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (non-Bash tool bypasses)" 0 "$TEST4_EXIT"

# Test 5: not gh pr create (gh pr view) → bypass
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 123"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (gh pr view bypasses)" 0 "$TEST5_EXIT"

# Test 6: bypass env var honored → exit 0 (checked at the top, before git)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"fix release banner\""}}'
TEST6_EXIT=$(HOOK_BYPASS_CROSS_TEAM_CODE_BATCH=1 bash -c "echo '$TEST6_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (HOOK_BYPASS env var allows)" 0 "$TEST6_EXIT"

# Report
echo ""
echo "cross-team-code-batch.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
