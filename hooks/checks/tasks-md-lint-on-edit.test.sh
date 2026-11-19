#!/bin/bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tasks-md-lint-on-edit.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
project="$fixture/project"
trusted_bin="$fixture/tools"
fixture_home="$fixture/home"
mkdir -p "$project/.git" "$project/bin" "$project/nested" "$trusted_bin" "$fixture_home"
jq_bin="$(command -v jq)"
ln -s "$jq_bin" "$trusted_bin/jq"

write_tasks() {
  cat > "$project/TASKS.md" <<'TASK'
# Tasks
## P2
- [ ] Test the edit check
  - **ID**: test-edit-check
  - **Hypothesis**: catch a missing required field.
  - **Measurement**: run the validator.
  - **Success**: one rejected edit.
  - **Anchor**: fixture
  - **Details**: synthetic-private-marker
TASK
  if [[ "$1" == valid ]]; then
    printf '  - **Pivot**: one accepted invalid task.\n' >> "$project/TASKS.md"
  fi
}

cat > "$trusted_bin/tasks-lint" <<'LINTER'
#!/bin/bash
set -euo pipefail
[[ "$1" == --require-prereg && "$2" == /*/TASKS.md ]]
[[ "$PWD" == "${BASH_SOURCE[0]%/*}" ]]
grep -qF '**Pivot**' "$2" && exit 0
printf '%s\n' 'synthetic-private-marker' >&2
exit 1
LINTER
chmod +x "$trusted_bin/tasks-lint"

run_case() {
  local label="$1" tool="$2" file="$3" fixture_path="$4" expected="$5" message="${6:-}"
  local payload output rc=0
  payload=$("$jq_bin" -nc --arg tool "$tool" --arg file "$file" --arg cwd "$project" \
    '{hook_event_name:"PostToolUse",tool_name:$tool,cwd:$cwd,tool_input:{file_path:$file}}')
  output=$(env -u DOTFILES_DIR -u DOTFILES_JQ HOME="$fixture_home" PATH="$fixture_path" \
    HOOK_DECISIONS_LOG="$fixture/decisions.jsonl" \
    /bin/bash "$script" <<<"$payload" 2>&1) || rc=$?
  if [[ "$rc" != "$expected" || "$output" == *synthetic-private-marker* ]]; then
    printf '%s\n' "$label: expected exit $expected with no marker, received $rc" >&2
    exit 1
  fi
  if [[ -z "$message" ]]; then
    [[ -z "$output" ]]
  else
    [[ "$output" == *"$message"* ]]
  fi
  printf '%s\n' "$label: exit $rc"
}

fixture_path="$trusted_bin:/usr/bin:/bin"
write_tasks valid
run_case "Valid root edit" Edit "$project/TASKS.md" "$fixture_path" 0
write_tasks invalid
cp "$project/TASKS.md" "$fixture/expected.md"
run_case "Missing required field" Write TASKS.md "$fixture_path" 2 "Run tasks-lint --require-prereg TASKS.md"
cmp "$fixture/expected.md" "$project/TASKS.md"
run_case "Unrelated file" Edit "$project/README.md" "$fixture_path" 0
cp "$project/TASKS.md" "$project/nested/TASKS.md"
run_case "Nested task file" Edit "$project/nested/TASKS.md" "$fixture_path" 0
run_case "Unrelated tool" Bash "$project/TASKS.md" "$fixture_path" 0

mv "$trusted_bin/tasks-lint" "$project/bin/tasks-lint"
cat > "$project/bin/tasks-lint" <<'PROJECT_TOOL'
#!/bin/bash
printf '%s\n' executed > "${BASH_SOURCE[0]%/*}/executed"
PROJECT_TOOL
run_case "Project-owned linter" Edit "$project/TASKS.md" "$project/bin:$fixture_path" 0 "outside the project"
[[ ! -e "$project/bin/executed" ]]

other_project="$fixture/other-project"
mkdir -p "$other_project/.git"
cp "$project/TASKS.md" "$other_project/TASKS.md"
cat > "$project/bin/python3" <<'PROJECT_PYTHON'
#!/bin/bash
printf '%s\n' executed > "${BASH_SOURCE[0]%/*}/python-executed"
exit 0
PROJECT_PYTHON
chmod +x "$project/bin/python3"
run_case "Cross-checkout project tools" Edit "$other_project/TASKS.md" "$project/bin:$fixture_path" 0 "outside the project"
[[ ! -e "$project/bin/executed" && ! -e "$project/bin/python-executed" ]]

cat > "$trusted_bin/tasks-lint" <<'SLOW_TOOL'
#!/bin/bash
(
  printf '%s\n' started > "${BASH_SOURCE[0]%/*}/child-started"
  /bin/sleep 2
  printf '%s\n' ran > "${BASH_SOURCE[0]%/*}/late-write"
) &
wait
SLOW_TOOL
chmod +x "$trusted_bin/tasks-lint"
run_case "Timed-out linter" Edit "$project/TASKS.md" "$fixture_path" 0 "reached its time limit"
[[ -f "$trusted_bin/child-started" ]]
/bin/sleep 1
[[ ! -e "$trusted_bin/late-write" ]]
cmp "$fixture/expected.md" "$project/TASKS.md"
! grep -qF synthetic-private-marker "$fixture/decisions.jsonl"
