#!/bin/bash

set -euo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-skill-requires-evals.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()
TMP_DIRS=()
LAST_TMP=""

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

write_skill() {
  local repo="$1"
  local name="$2"
  mkdir -p "$repo/.agents/skills/$name"
  cat >"$repo/.agents/skills/$name/SKILL.md" <<EOF
---
name: $name
description: Test skill. Don't use for real work.
---

## Steps

Do the thing.
EOF
}

write_evals() {
  local repo="$1"
  local name="$2"
  local check_field="$3"
  mkdir -p "$repo/.agents/skills/$name/evals"
  cat >"$repo/.agents/skills/$name/evals/evals.json" <<EOF
{
  "evals": [
    {"prompt": "first prompt", "$check_field": ["one", "two", "three"]},
    {"prompt": "second prompt", "$check_field": ["one", "two", "three"]},
    {"prompt": "third prompt", "$check_field": ["one", "two", "three"]}
  ]
}
EOF
}

write_invalid_evals() {
  local repo="$1"
  local name="$2"
  mkdir -p "$repo/.agents/skills/$name/evals"
  cat >"$repo/.agents/skills/$name/evals/evals.json" <<EOF
{
  "evals": [
    {"prompt": "first prompt"},
    {"prompt": "second prompt"},
    {"prompt": "third prompt"}
  ]
}
EOF
}

new_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null
  echo base >"$repo/README.md"
  commit_all "$repo" "seed"
  git -C "$repo" switch -c feature >/dev/null 2>&1
}

new_repo_with_existing_skill() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null
  echo base >"$repo/README.md"
  write_skill "$repo" "existing"
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
  input="$(jq -n --arg command "$command" --arg cwd "$repo" '{session_id:"test-session", transcript_path:"/tmp/gh-pr-skill-requires-evals-test.jsonl", hook_event_name:"PreToolUse", tool_name:"Bash", cwd:$cwd, tool_input:{command:$command}}')"
  set +e
  printf '%s' "$input" | HOME="$repo/home" bash "$SCRIPT" >"$stdout_file" 2>"$stderr_file"
  LAST_EXIT=$?
  set -e
  LAST_STDERR="$(cat "$stderr_file")"
}

valid_body() {
  cat <<'EOF'
## Summary

Add skill.

## Skill eval results

The evals pass.

## How to run these tests yourself

bash hooks/checks/gh-pr-skill-requires-evals.test.sh
EOF
}

missing_sections_body() {
  cat <<'EOF'
## Summary

Add skill.
EOF
}

only_results_body() {
  cat <<'EOF'
## Summary

Add skill.

## Skill eval results

The evals pass.
EOF
}

only_runbook_body() {
  cat <<'EOF'
## Summary

Add skill.

## How to run these tests yourself

bash hooks/checks/gh-pr-skill-requires-evals.test.sh
EOF
}

run_case() {
  local label="$1"
  local expected="$2"
  local setup_name="$3"
  local body="$4"
  local tmp
  make_tmp
  tmp="$LAST_TMP"
  new_repo "$tmp/repo"
  "$setup_name" "$tmp/repo"
  commit_all "$tmp/repo" "fixture"
  run_hook "$tmp/repo" "gh pr create --body \"$body\""
  assert_exit_code "$label" "$expected" "$LAST_EXIT"
}

setup_adds_skill_with_assertions_evals() {
  write_skill "$1" "demo"
  write_evals "$1" "demo" "assertions"
}

setup_adds_skill_without_evals() {
  write_skill "$1" "demo"
}

setup_adds_skill_with_expectations_evals() {
  write_skill "$1" "demo"
  write_evals "$1" "demo" "expectations"
}

setup_adds_skill_with_invalid_evals() {
  write_skill "$1" "demo"
  write_invalid_evals "$1" "demo"
}

setup_adds_skill_with_empty_expectations() {
  write_skill "$1" "demo"
  mkdir -p "$1/.agents/skills/demo/evals"
  cat >"$1/.agents/skills/demo/evals/evals.json" <<'EOF'
{
  "evals": [
    {"prompt": "first prompt", "expectations": []},
    {"prompt": "second prompt", "expectations": ["one", "two", "three"]},
    {"prompt": "third prompt", "expectations": ["one", "two", "three"]}
  ]
}
EOF
}

setup_adds_skill_with_whitespace_expectations() {
  write_skill "$1" "demo"
  mkdir -p "$1/.agents/skills/demo/evals"
  cat >"$1/.agents/skills/demo/evals/evals.json" <<'EOF'
{
  "evals": [
    {"prompt": "first prompt", "expectations": ["   ", "  ", " "]},
    {"prompt": "second prompt", "expectations": ["one", "two", "three"]},
    {"prompt": "third prompt", "expectations": ["one", "two", "three"]}
  ]
}
EOF
}

setup_adds_skill_with_two_evals() {
  write_skill "$1" "demo"
  mkdir -p "$1/.agents/skills/demo/evals"
  cat >"$1/.agents/skills/demo/evals/evals.json" <<'EOF'
{
  "evals": [
    {"prompt": "first prompt", "expectations": ["one", "two", "three"]},
    {"prompt": "second prompt", "expectations": ["one", "two", "three"]}
  ]
}
EOF
}

setup_adds_skill_with_two_checks() {
  write_skill "$1" "demo"
  mkdir -p "$1/.agents/skills/demo/evals"
  cat >"$1/.agents/skills/demo/evals/evals.json" <<'EOF'
{
  "evals": [
    {"prompt": "first prompt", "expectations": ["one", "two"]},
    {"prompt": "second prompt", "expectations": ["one", "two", "three"]},
    {"prompt": "third prompt", "expectations": ["one", "two", "three"]}
  ]
}
EOF
}

setup_adds_two_skills_one_missing_evals() {
  write_skill "$1" "demo"
  write_evals "$1" "demo" "assertions"
  write_skill "$1" "missing"
}

setup_adds_skill_with_space_in_name() {
  write_skill "$1" "demo skill"
  write_evals "$1" "demo skill" "assertions"
}

setup_modifies_existing_skill_without_evals() {
  printf '\nExtra step.\n' >>"$1/.agents/skills/existing/SKILL.md"
}

setup_unrelated_pr() {
  echo change >>"$1/README.md"
}

BODY="$(valid_body)"
run_case "adds-skill-with-evals" 0 setup_adds_skill_with_assertions_evals "$BODY"
run_case "adds-skill-no-evals" 2 setup_adds_skill_without_evals "$BODY"
run_case "adds-skill-evals-but-no-pr-section" 2 setup_adds_skill_with_assertions_evals "$(missing_sections_body)"
run_case "adds-skill-evals-with-only-results-section" 2 setup_adds_skill_with_assertions_evals "$(only_results_body)"
run_case "adds-skill-evals-with-only-runbook-section" 2 setup_adds_skill_with_assertions_evals "$(only_runbook_body)"
run_case "adds-skill-evals-with-only-expectations" 0 setup_adds_skill_with_expectations_evals "$BODY"
run_case "adds-skill-evals-missing-both-check-fields" 2 setup_adds_skill_with_invalid_evals "$BODY"
run_case "adds-skill-evals-empty-expectations" 2 setup_adds_skill_with_empty_expectations "$BODY"
run_case "adds-skill-evals-whitespace-expectations" 2 setup_adds_skill_with_whitespace_expectations "$BODY"
run_case "adds-skill-evals-with-two-evals" 2 setup_adds_skill_with_two_evals "$BODY"
run_case "adds-skill-evals-with-two-checks" 2 setup_adds_skill_with_two_checks "$BODY"
run_case "adds-two-skills-one-missing-evals" 2 setup_adds_two_skills_one_missing_evals "$BODY"
run_case "adds-skill-with-space-in-name" 0 setup_adds_skill_with_space_in_name "$BODY"

make_tmp
TMP_MODIFY="$LAST_TMP"
new_repo_with_existing_skill "$TMP_MODIFY/repo"
setup_modifies_existing_skill_without_evals "$TMP_MODIFY/repo"
commit_all "$TMP_MODIFY/repo" "modify existing"
run_hook "$TMP_MODIFY/repo" "gh pr create --body \"$(missing_sections_body)\""
assert_exit_code "modifies-existing-skill-without-new-evals" 0 "$LAST_EXIT"
assert_stderr_contains "modifies-existing-skill-without-new-evals" "WARN" "$LAST_STDERR"

make_tmp
TMP_BODY_FILE="$LAST_TMP"
new_repo "$TMP_BODY_FILE/repo"
setup_adds_skill_with_assertions_evals "$TMP_BODY_FILE/repo"
valid_body >"$TMP_BODY_FILE/repo/pr body.md"
commit_all "$TMP_BODY_FILE/repo" "body file"
run_hook "$TMP_BODY_FILE/repo" "gh pr create --body-file \"$TMP_BODY_FILE/repo/pr body.md\""
assert_exit_code "adds-skill-with-body-file" 0 "$LAST_EXIT"

make_tmp
TMP_MIXED="$LAST_TMP"
new_repo_with_existing_skill "$TMP_MIXED/repo"
setup_adds_skill_without_evals "$TMP_MIXED/repo"
setup_modifies_existing_skill_without_evals "$TMP_MIXED/repo"
commit_all "$TMP_MIXED/repo" "mixed add modify"
run_hook "$TMP_MIXED/repo" "gh pr create --body \"$BODY\""
assert_exit_code "mixed-add-and-modify-blocks-new-skill-without-evals" 2 "$LAST_EXIT"

run_case "unrelated-PR" 0 setup_unrelated_pr "$(missing_sections_body)"

echo ""
echo "gh-pr-skill-requires-evals.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
