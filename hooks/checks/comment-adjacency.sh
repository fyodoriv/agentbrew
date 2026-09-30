#!/bin/bash
# agentbrew/hooks/checks/comment-adjacency.sh
#
# **Hook**: comment-adjacency
# **Event**: PostToolUse on Write|Edit
# **Verdict**: warn (informational — false-positive risk too high to block)
# **Source rule**: shared-rules.md:432 "Comment Adjacency (IRON LAW)"
#
# Warns when a comment block in code is followed by BLANK LINES before
# the function/const it documents. The rule: comments must be physically
# adjacent to the thing they describe — a comment with a blank-line gap
# becomes orphaned during refactor and stops mapping to its target.
#
# **What triggers a warning**:
#   - `// doc here\n\nfunction foo()` (blank line between doc and fn)
#   - `/**\n * jsdoc\n */\n\nexport const x = 1` (blank line after jsdoc)
#
# **What does NOT trigger**:
#   - `// doc here\nfunction foo()` (adjacent, OK)
#   - `// chapter header` (no adjacent target, OK as section header)
#   - Markdown files, comments inside strings
#
# **Bypass**: `HOOK_BYPASS_COMMENT_ADJACENCY=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="comment-adjacency"

if [ "${HOOK_BYPASS_COMMENT_ADJACENCY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_COMMENT_ADJACENCY=1"
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

# Scope: code files only
case "$FILE_PATH" in
  *.md|*.markdown|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock|*.test.*|*.spec.*)
    verdict_bypass "$HOOK_ID" "$FILE_PATH out of scope"
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

# Use awk to detect: comment line followed by blank line followed by
# code (function / const / let / var / export / class / type / interface).
# This is a heuristic — we look for the orphan pattern across 3-line windows.
ORPHANED=$(printf '%s' "$CONTENT" | awk '
  /^[[:space:]]*(\/\/|#|\/\*|\*\/?|\*)/ { last_comment_line=NR; next }
  /^[[:space:]]*$/ {
    if (NR == last_comment_line + 1) { blank_after_comment=1; blank_line=NR; }
    next
  }
  /^[[:space:]]*(export|function|const|let|var|class|type|interface|async)[[:space:]]/ {
    if (blank_after_comment && NR == blank_line + 1) {
      print NR ": " $0
      blank_after_comment = 0
    }
  }
  { blank_after_comment = 0 }
' | head -1)

if [ -n "$ORPHANED" ]; then
  verdict_warn "$HOOK_ID" "Comment Adjacency (IRON LAW): possible orphaned comment in $FILE_PATH near '$ORPHANED'. Move the comment immediately above the function/const it documents (no blank line). Bypass: HOOK_BYPASS_COMMENT_ADJACENCY=1."
fi

verdict_allow "$HOOK_ID" "no orphaned comment pattern detected"
