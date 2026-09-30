#!/bin/bash
# Test fixture for checks/skill-names-user-facing-verbs.sh
#
# Tests the hook by piping fixture JSON inputs to it and asserting the
# exit code. Run: `bash skill-names-user-facing-verbs.test.sh`
# (assumes you're in agentbrew/hooks/checks/).
#
# The hook fires on Write|Edit to a */SKILL.md and blocks (exit 2) when
# the `name:` frontmatter field contains internal jargon (acronyms /
# codenames matched by the script's JARGON_REGEX, e.g. domain-jargon plus SKILL_NAMES_JARGON_TERMS).

set -uo pipefail

export SKILL_NAMES_JARGON_TERMS="acme"
unset SKILL_NAMES_ORG_REPO_REGEX SKILL_NAMES_ENFORCE_IN_ORG_REPOS

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/skill-names-user-facing-verbs.sh"
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

# Test 1: Write SKILL.md with a jargon-free verb name → allow (exit 0)
TEST1_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/skills/configure-release/SKILL.md","content":"---\nname: configure-release\ndescription: Configure a release.\n---\n\n## Steps\n"}}'
TEST1_EXIT=$(echo "$TEST1_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST1_EXIT=$(echo "$TEST1_EXIT" | tail -1)
assert_exit_code "Test 1 (clean verb name)" 0 "$TEST1_EXIT"

# Test 2: Write SKILL.md with `name: acme-loader` (acme jargon) → block (exit 2)
TEST2_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/skills/acme-loader/SKILL.md","content":"---\nname: acme-loader\ndescription: Load it.\n---\n"}}'
TEST2_EXIT=$(echo "$TEST2_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST2_EXIT=$(echo "$TEST2_EXIT" | tail -1)
assert_exit_code "Test 2 (jargon name acme-loader)" 2 "$TEST2_EXIT"

# Test 3: Edit SKILL.md new_string sets `name: domain-jargon-runner` → block
TEST3_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/skills/x/SKILL.md","old_string":"name: run-pipeline","new_string":"name: domain-jargon-runner"}}'
TEST3_EXIT=$(echo "$TEST3_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST3_EXIT=$(echo "$TEST3_EXIT" | tail -1)
assert_exit_code "Test 3 (Edit to jargon name domain-jargon-name)" 2 "$TEST3_EXIT"

# Test 4: Non-SKILL.md file with jargon name → bypass (exit 0)
TEST4_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/foo/config.md","content":"---\nname: acme-loader\n---\n"}}'
TEST4_EXIT=$(echo "$TEST4_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST4_EXIT=$(echo "$TEST4_EXIT" | tail -1)
assert_exit_code "Test 4 (non-SKILL.md file bypasses)" 0 "$TEST4_EXIT"

# Test 5: Non-matching tool (Bash) → bypass (exit 0)
TEST5_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello"}}'
TEST5_EXIT=$(echo "$TEST5_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST5_EXIT=$(echo "$TEST5_EXIT" | tail -1)
assert_exit_code "Test 5 (non-Write/Edit tool bypasses)" 0 "$TEST5_EXIT"

# Test 6: Edit that sets a jargon-free verb name → allow (exit 0)
TEST6_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/skills/x/SKILL.md","old_string":"name: old-name","new_string":"name: summarize-document"}}'
TEST6_EXIT=$(echo "$TEST6_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST6_EXIT=$(echo "$TEST6_EXIT" | tail -1)
assert_exit_code "Test 6 (Edit to clean verb name allowed)" 0 "$TEST6_EXIT"

# Test 7: Bypass env var honored on a violating input → allow (exit 0)
TEST7_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/skills/acme-loader/SKILL.md","content":"---\nname: acme-loader\n---\n"}}'
TEST7_EXIT=$(HOOK_BYPASS_SKILL_NAMES_USER_FACING_VERBS=1 bash -c "echo '$TEST7_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST7_EXIT=$(echo "$TEST7_EXIT" | tail -1)
assert_exit_code "Test 7 (HOOK_BYPASS env var allows)" 0 "$TEST7_EXIT"

# Test 8: Edit whose new_string has NO name: line → allow (exit 0).
# Regression guard: an unguarded grep pipeline under `set -euo pipefail`
# previously made this exit 1 (crash) instead of the documented allow.
TEST8_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/repo/skills/foo/SKILL.md","old_string":"x","new_string":"description: reword only, no name field touched"}}'
TEST8_EXIT=$(echo "$TEST8_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST8_EXIT=$(echo "$TEST8_EXIT" | tail -1)
assert_exit_code "Test 8 (Edit without name: line allowed)" 0 "$TEST8_EXIT"

# Test 9: jargon name under a path matched by SKILL_NAMES_ORG_REPO_REGEX → bypass (exit 0).
TEST9_INPUT='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/Users/x/apps/acme-app/skills/acme-experiments/SKILL.md","new_string":"---\nname: acme-experiments\n---\nbody"}}'
TEST9_EXIT=$(SKILL_NAMES_ORG_REPO_REGEX='/acme-app([/-][^/]*)?/' bash -c "echo '$TEST9_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST9_EXIT=$(echo "$TEST9_EXIT" | tail -1)
assert_exit_code "Test 9 (org repo regex bypasses jargon check)" 0 "$TEST9_EXIT"

# Test 10: same path without the regex configured → block (exit 2).
TEST10_EXIT=$(echo "$TEST9_INPUT" | bash "$SCRIPT" 2>/dev/null; echo $?)
TEST10_EXIT=$(echo "$TEST10_EXIT" | tail -1)
assert_exit_code "Test 10 (no org regex, jargon blocked)" 2 "$TEST10_EXIT"

# Test 11: SKILL_NAMES_ENFORCE_IN_ORG_REPOS=1 re-enables the check → block (exit 2).
TEST11_EXIT=$(SKILL_NAMES_ORG_REPO_REGEX='/acme-app([/-][^/]*)?/' SKILL_NAMES_ENFORCE_IN_ORG_REPOS=1 bash -c "echo '$TEST9_INPUT' | bash '$SCRIPT' 2>/dev/null; echo \$?")
TEST11_EXIT=$(echo "$TEST11_EXIT" | tail -1)
assert_exit_code "Test 11 (enforce override re-enables in org repos)" 2 "$TEST11_EXIT"

# Report
echo ""
echo "skill-names-user-facing-verbs.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
