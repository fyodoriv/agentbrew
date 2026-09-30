#!/bin/bash
# agentbrew/hooks/checks/gdoc-surgical-edit-only.sh
#
# **Hook**: gdoc-surgical-edit-only
# **Event**: PreToolUse on mcp__company-google-drive-mcp__* (GDoc update)
# **Verdict**: block
# **Source rule**: shared-rules.md:1540 "GDoc Surgical-Edit-Only Rule (ABSOLUTE)"
#
# Blocks Google Docs API calls that would replace the entire document
# body in a single operation. The rule: edits must be surgical
# (`replaceText` for specific ranges, `batchUpdate` with localized
# operations) — never wholesale-replace. Replacement destroys
# paragraph styles, table widths, comment anchors, list nesting.
#
# **What gets blocked**:
#   - `update_doc` with a `body` field containing the FULL document text
#   - `batchUpdate` with a single `replaceAllText` that targets the entire doc
#   - `update_doc` with `replaceMode: full` / `mode: replace`
#
# **What does NOT get blocked**:
#   - Surgical `replaceText` with specific old/new ranges
#   - `batchUpdate` with multiple localized ops (each <1KB payload)
#   - Insert-only operations (insertText, insertTable, insertImage)
#
# **Bypass**: `HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1` for the rare case
# (e.g. a deliberate doc rebuild after explicit user instruction).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gdoc-surgical-edit-only"
# If a payload exceeds this many bytes, suspect wholesale-replace
readonly MAX_PAYLOAD_BYTES=8000

if [ "${HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

case "$HOOK_TOOL_NAME" in
  mcp__company-google-drive-mcp__*|mcp__google-drive-mcp__*|mcp__drive__*)
    : # in scope
    ;;
  *)
    verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not a google-drive MCP call"
    ;;
esac

# Only fire on update / write tools
case "$HOOK_TOOL_NAME" in
  *update*|*write*|*replace*|*batchUpdate*|*createDoc*)
    : # in scope
    ;;
  *)
    verdict_bypass "$HOOK_ID" "$HOOK_TOOL_NAME is not a write/update operation"
    ;;
esac

# Check the payload size + shape
PAYLOAD_SIZE=$(printf '%s' "$INPUT" | jq -r '.tool_input | tostring | length' 2>/dev/null || echo 0)
REPLACE_MODE=$(json_get "$INPUT" '.tool_input.replaceMode // .tool_input.mode // ""')
HAS_BODY=$(json_get "$INPUT" '.tool_input.body // ""')

# Detect wholesale-replace by mode field
case "$REPLACE_MODE" in
  "full"|"replace"|"FULL"|"REPLACE")
    verdict_block "$HOOK_ID" "GDoc Surgical-Edit-Only (ABSOLUTE): tool $HOOK_TOOL_NAME called with mode '$REPLACE_MODE'. Wholesale-replace destroys paragraph styles, table widths, comment anchors, list nesting. Use surgical operations: replaceText for specific ranges, batchUpdate with multiple localized ops. Bypass: HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1."
    ;;
esac

# Detect wholesale-replace by huge payload
if [ "$PAYLOAD_SIZE" -gt "$MAX_PAYLOAD_BYTES" ] && [ -n "$HAS_BODY" ]; then
  verdict_block "$HOOK_ID" "GDoc Surgical-Edit-Only (ABSOLUTE): tool $HOOK_TOOL_NAME has a payload of ${PAYLOAD_SIZE} bytes with a body field — likely wholesale-replace. Surgical ops (replaceText, insertText) should be <8KB each. Split into multiple targeted batchUpdate requests. Bypass: HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1."
fi

# Detect replaceAllText with empty match pattern (matches everything)
if printf '%s' "$INPUT" | grep -qE 'replaceAllText.*containsText[^"]*""'; then
  verdict_block "$HOOK_ID" "GDoc Surgical-Edit-Only (ABSOLUTE): replaceAllText with empty match pattern targets the entire doc. Use a specific search string. Bypass: HOOK_BYPASS_GDOC_SURGICAL_EDIT_ONLY=1."
fi

verdict_allow "$HOOK_ID" "edit appears surgical (size=${PAYLOAD_SIZE} bytes)"
