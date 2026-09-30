#!/bin/bash
# agentbrew/hooks/checks/comment-proportionality.sh
#
# **Hook**: comment-proportionality
# **Event**: PostToolUse on Write|Edit
# **Verdict**: warn
# **Source rule**: shared-rules.md:865 "Comment Proportionality (IRON LAW)"
#
# Warns when a diff has an unusually high comment-to-code ratio in a
# Write (full file). The rule's intent: comments should be proportional
# to code complexity — a 1-line function with a 10-line JSDoc block is
# under-coded, not well-documented. Threshold: comment lines should be
# < 50% of total non-blank lines (heuristic).
#
# **What triggers a warning**:
#   - Write of a 50-line file with 35 comment lines, 15 code lines
#
# **What does NOT trigger**:
#   - Edits (only Write — Edit diffs are too small for ratio judgment)
#   - Test files (separate rule)
#   - Markdown / docs / configs
#
# **Bypass**: `HOOK_BYPASS_COMMENT_PROPORTIONALITY=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="comment-proportionality"
readonly MIN_FILE_LINES=20  # don't apply ratio judgment to tiny files
readonly MAX_COMMENT_RATIO_PCT=50

if [ "${HOOK_BYPASS_COMMENT_PROPORTIONALITY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_COMMENT_PROPORTIONALITY=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Only fire on Write (Edit diffs are too small)
if [ "$HOOK_TOOL_NAME" != "Write" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Write"
fi

FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"

# Skip: non-code, tests, docs
case "$FILE_PATH" in
  *.md|*.markdown|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock|*.test.*|*.spec.*|*/__tests__/*|*/tests/*)
    verdict_bypass "$HOOK_ID" "$FILE_PATH out of scope"
    ;;
esac

CONTENT="$(json_get "$INPUT" '.tool_input.content')"
if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no content"
fi

# Count comment lines vs code lines
COUNTS=$(printf '%s' "$CONTENT" | awk '
  { total++ }
  /^[[:space:]]*$/ { blank++; next }
  /^[[:space:]]*(\/\/|#|\/\*|\*\/?|\*)/ { comments++; next }
  { code++ }
  END {
    nonblank = total - blank
    if (nonblank < 1) nonblank = 1
    print nonblank, comments, code
  }
')

NONBLANK=$(echo "$COUNTS" | awk '{print $1}')
COMMENTS=$(echo "$COUNTS" | awk '{print $2}')
CODE=$(echo "$COUNTS" | awk '{print $3}')

if [ -z "$NONBLANK" ] || [ "$NONBLANK" -lt "$MIN_FILE_LINES" ]; then
  verdict_bypass "$HOOK_ID" "file too small ($NONBLANK nonblank lines)"
fi

# Calculate ratio (integer math: comments*100 / nonblank)
RATIO=$(( COMMENTS * 100 / NONBLANK ))

if [ "$RATIO" -gt "$MAX_COMMENT_RATIO_PCT" ]; then
  verdict_warn "$HOOK_ID" "Comment Proportionality (IRON LAW): $FILE_PATH has ${RATIO}% comments ($COMMENTS comment lines / $NONBLANK total nonblank). Threshold: ${MAX_COMMENT_RATIO_PCT}%.
Either: (a) inline some comments into more expressive code/names, (b) collapse multi-line jsdoc into 1-2 line summaries, or (c) move long explanations to a sibling .md file. Bypass: HOOK_BYPASS_COMMENT_PROPORTIONALITY=1."
fi

verdict_allow "$HOOK_ID" "comment ratio ${RATIO}% within threshold"
