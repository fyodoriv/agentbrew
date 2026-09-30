#!/bin/bash
# agentbrew/hooks/checks/comment-brevity-in-tests.sh
#
# **Hook**: comment-brevity-in-tests
# **Event**: PostToolUse on Write|Edit
# **Verdict**: warn
# **Source rule**: shared-rules.md:419 + templates/AGENTS.md:419 "Comment Brevity in Tests (IRON LAW)"
#
# Warns when a test file has 4+ line comment blocks above `it(...)` /
# `describe(...)` / `test(...)` calls. Tests should be self-documenting
# via their descriptive name string ("it returns null when input is
# empty") — long comment blocks above tests duplicate the name + rot.
#
# **What triggers a warning**:
#   - Test file with 5-line `/** ... */` block above `it(...)`
#   - 6 consecutive `//` lines before `describe(...)`
#
# **What does NOT trigger**:
#   - 1-3 line comments are fine (occasional context note)
#   - Test files with no comments
#   - Non-test files (separate rule)
#
# **Bypass**: `HOOK_BYPASS_COMMENT_BREVITY_IN_TESTS=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="comment-brevity-in-tests"
readonly MAX_COMMENT_LINES=3

if [ "${HOOK_BYPASS_COMMENT_BREVITY_IN_TESTS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_COMMENT_BREVITY_IN_TESTS=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

if [ "$HOOK_TOOL_NAME" != "Write" ] && [ "$HOOK_TOOL_NAME" != "Edit" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Write|Edit"
fi

FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"

# Only fire on test files
case "$FILE_PATH" in
  *.test.*|*.spec.*|*/__tests__/*|*/tests/*|*/test/*|*.bats)
    : # continue
    ;;
  *)
    verdict_bypass "$HOOK_ID" "$FILE_PATH not a test file"
    ;;
esac

CONTENT=""
if [ "$HOOK_TOOL_NAME" = "Write" ]; then
  CONTENT="$(json_get "$INPUT" '.tool_input.content')"
else
  CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"
fi

if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no content"
fi

# Count consecutive comment lines preceding a test declaration. awk
# tracks a comment-line counter that resets on non-comment + checks
# the count when hitting it/describe/test.
LONG_BLOCKS=$(printf '%s' "$CONTENT" | awk -v max="$MAX_COMMENT_LINES" '
  /^[[:space:]]*(\/\/|#|\/\*|\*\/?|\*)/ { count++; next }
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*(it|describe|test|context)[[:space:]]*\(/ {
    if (count > max) {
      print NR ": " count " lines before " $0
    }
    count = 0; next
  }
  { count = 0 }
' | head -3)

if [ -n "$LONG_BLOCKS" ]; then
  verdict_warn "$HOOK_ID" "Comment Brevity in Tests (IRON LAW): found long comment block(s) in $FILE_PATH:
$LONG_BLOCKS
Tests should be self-documenting via the descriptive name string. Move the context into the test description or delete it. Bypass: HOOK_BYPASS_COMMENT_BREVITY_IN_TESTS=1."
fi

verdict_allow "$HOOK_ID" "no long comment blocks before tests"
