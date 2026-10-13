#!/bin/bash
# Test fixture for checks/gh-pr-body-requires-docs.sh

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/gh-pr-body-requires-docs.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

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

run_hook() {
  local exit_code
  exit_code=$(echo "$1" | bash "$SCRIPT" 2>/dev/null; echo $?)
  echo "$exit_code" | tail -1
}

pr_create() {
  printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --body \\"%s\\""}}' "$1"
}

assert_exit_code "Test 1 (## Docs section)" 0 "$(run_hook "$(pr_create '## Summary\\nWhy.\\n\\n## Docs\\n- README.md: new flag')")"
assert_exit_code "Test 2 (Docs: none with reason)" 0 "$(run_hook "$(pr_create '## Summary\\nWhy.\\n\\nDocs: none — internal refactor, no behavior change')")"
assert_exit_code "Test 3 (Docs: none with -- and a reason)" 0 "$(run_hook "$(pr_create 'Docs: none -- test-only change')")"
assert_exit_code "Test 4 (no docs line blocks)" 2 "$(run_hook "$(pr_create '## Summary\\nWhy.\\n\\n## Details\\n- a')")"
assert_exit_code "Test 5 (Docs: none without a reason blocks)" 2 "$(run_hook "$(pr_create '## Summary\\nWhy.\\n\\nDocs: none')")"
assert_exit_code "Test 6 (## Docs inside a longer heading blocks)" 2 "$(run_hook "$(pr_create '## Docs-free refactor\\nWhy.')")"
assert_exit_code "Test 7 (gh pr view passes)" 0 "$(run_hook '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr view 12"}}')"
assert_exit_code "Test 8 (not Bash passes)" 0 "$(run_hook '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"x"}}')"

TEST9_EXIT=$(HOOK_BYPASS_GH_PR_BODY_REQUIRES_DOCS=1 bash -c "echo '$(pr_create 'no docs')' | bash '$SCRIPT' 2>/dev/null; echo \$?" | tail -1)
assert_exit_code "Test 9 (bypass env var)" 0 "$TEST9_EXIT"

BODY_FILE="$(mktemp)"
printf '## Summary\nWhy.\n\n## Docs\n- AGENTS.md: new gotcha\n' > "$BODY_FILE"
assert_exit_code "Test 10 (--body-file with ## Docs)" 0 "$(run_hook "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr create --body-file $BODY_FILE\"}}")"
printf '## Summary\nWhy.\n' > "$BODY_FILE"
assert_exit_code "Test 11 (--body-file without docs blocks)" 2 "$(run_hook "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr create --body-file $BODY_FILE\"}}")"
rm -f "$BODY_FILE"

# Heredoc bodies span many lines; the hook must still read them.
heredoc_input() {
  jq -nc --arg cmd "$1" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$cmd}}'
}
HEREDOC_NO_DOCS=$'gh pr create --title "x" --body "$(cat <<\'EOF\'\n## Summary\nWhy.\n\n## Details\n- a\nEOF\n)"'
HEREDOC_DOCS=$'gh pr create --title "x" --body "$(cat <<\'EOF\'\n## Summary\nWhy.\n\n## Docs\n- README.md: x\nEOF\n)"'
assert_exit_code "Test 12 (heredoc body without docs blocks)" 2 "$(run_hook "$(heredoc_input "$HEREDOC_NO_DOCS")")"
assert_exit_code "Test 13 (heredoc body with ## Docs)" 0 "$(run_hook "$(heredoc_input "$HEREDOC_DOCS")")"

echo ""
echo "gh-pr-body-requires-docs.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
