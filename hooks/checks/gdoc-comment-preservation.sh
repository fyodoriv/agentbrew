#!/bin/bash
# agentbrew/hooks/checks/gdoc-comment-preservation.sh
#
# **Hook**: gdoc-comment-preservation
# **Event**: PreToolUse on mcp__company-google-drive-mcp__* (any GDoc update)
# **Verdict**: block
# **Source rule**: shared-rules.md:1528 "GDoc Comment Preservation Rule (ABSOLUTE)"
#
# Blocks any Google Docs update call that would delete or modify
# existing reviewer comments. GDoc comments are anchors for cross-
# document review threads — the agent should NEVER resolve, delete,
# or move a comment unless the user explicitly asked.
#
# The MCP tool surface for Google Drive varies by integration. Common
# tools that touch documents:
#   - mcp__company-google-drive-mcp__update_doc
#   - mcp__company-google-drive-mcp__batchUpdate
#   - mcp__google-drive-mcp__replaceText
#   - mcp__google-drive-mcp__deleteCommentReply
#   - mcp__google-drive-mcp__resolveComment
#
# **What gets blocked**:
#   - Any *resolveComment* / *deleteComment* call (always — even
#     for the agent's own comments; user owns this decision)
#   - *batchUpdate* requests with `deleteRange` / `deleteParagraphBullets`
#     ops that might inadvertently delete commented ranges
#
# **What does NOT get blocked**:
#   - Insert-only edits (insertText, insertTable)
#   - Read-only tool calls (get, list, search)
#
# **Bypass**: `HOOK_BYPASS_GDOC_COMMENT_PRESERVATION=1` ONLY when the
# user explicitly asked to resolve/delete the comment in the current
# session. Log + explain.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gdoc-comment-preservation"

if [ "${HOOK_BYPASS_GDOC_COMMENT_PRESERVATION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GDOC_COMMENT_PRESERVATION=1 (verify user-approval in session)"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Only fire on google-drive MCP tool calls
case "$HOOK_TOOL_NAME" in
  mcp__company-google-drive-mcp__*|mcp__google-drive-mcp__*|mcp__drive__*)
    : # in scope
    ;;
  *)
    verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not a google-drive MCP call"
    ;;
esac

# Always block direct comment-modification tools
case "$HOOK_TOOL_NAME" in
  *resolveComment*|*deleteComment*|*updateComment*|*removeReply*)
    verdict_block "$HOOK_ID" "GDoc Comment Preservation (ABSOLUTE): tool $HOOK_TOOL_NAME modifies/resolves/deletes an existing comment. The user owns the comment lifecycle — never resolve/delete unless explicitly asked.
Bypass: HOOK_BYPASS_GDOC_COMMENT_PRESERVATION=1 (only after explicit user permission for THIS comment in THIS session)."
    ;;
esac

# For batchUpdate / replaceText calls, check the payload for delete ops
# that might inadvertently destroy commented content
if printf '%s' "$HOOK_TOOL_NAME" | grep -qiE 'batchUpdate|replaceText|deleteContentRange'; then
  PAYLOAD=$(json_get "$INPUT" '.tool_input.requests // .tool_input.body // ""')
  if printf '%s' "$PAYLOAD" | grep -qiE 'deleteRange|deleteParagraphBullets|deleteContentRange'; then
    verdict_warn "$HOOK_ID" "GDoc Comment Preservation (ABSOLUTE): $HOOK_TOOL_NAME contains delete operations that may destroy commented content. Verify NO comments anchor to the deleted range before proceeding. The MCP API does not always preserve comment anchors across deletes. Bypass: HOOK_BYPASS_GDOC_COMMENT_PRESERVATION=1."
  fi
fi

verdict_allow "$HOOK_ID" "tool $HOOK_TOOL_NAME doesn't modify comments"
