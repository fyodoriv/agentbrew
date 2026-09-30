#!/bin/bash
# agentbrew/hooks/checks/code-no-timestamps.sh
#
# **Hook**: code-no-timestamps
# **Event**: PreToolUse on Write|Edit
# **Verdict**: block
# **Source rule**: shared-rules.md:826 "Code Has No Time Stamps (IRON LAW)"
#
# Blocks Write|Edit operations that introduce a literal YYYY-MM-DD date
# comment into source-shaped files. The rule exists because timestamps
# in code drift the moment the code is reviewed / merged / rebased —
# they become noise that future readers have to filter through. The
# canonical replacement is a relative reference ("after the cleanup pass"
# or "during the 2026-Q2 refactor") or a ticket reference, both of
# which retain their meaning over time.
#
# **What gets blocked**:
#   - `// 2026-05-27 — added the foo`
#   - `# 2026-05-27: refactor` in shell / python
#   - `/* 2024-11-15 */` in JS / CSS / Java
#   - `* 2025-01-01` in JSDoc
#
# **What does NOT get blocked**:
#   - Year-only references: `// 2026 refactor`
#   - Range references: `// 2024-Q1 through 2026-Q2`
#   - Date-in-string-content (the regex requires comment markers)
#   - Edits to non-source files (.md, .txt, .yaml, .yml, .json — these
#     legitimately track dated context like CHANGELOG entries)
#
# **Bypass**: `HOOK_BYPASS_CODE_NO_TIMESTAMPS=1` env var skips this hook
# (for the rare case where a date stamp IS the right move — e.g. a
# generated banner, a TODO tied to a deadline you want visible).
#
# **Test**: `bash code-no-timestamps.test.sh`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="code-no-timestamps"

# Honor explicit bypass
if [ "${HOOK_BYPASS_CODE_NO_TIMESTAMPS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_CODE_NO_TIMESTAMPS=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Only fire on Write or Edit
if [ "$HOOK_TOOL_NAME" != "Write" ] && [ "$HOOK_TOOL_NAME" != "Edit" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Write|Edit"
fi

# Skip files that legitimately track dates (docs, configs).
FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"
case "$FILE_PATH" in
  *.md|*.markdown|*.txt|*.yaml|*.yml|*.json|*.toml|*CHANGELOG*|*HISTORY*|*RELEASE*)
    verdict_bypass "$HOOK_ID" "file $FILE_PATH legitimately tracks dates"
    ;;
esac

# The content to check varies by tool:
#   Write: .tool_input.content (full file body)
#   Edit:  .tool_input.new_string (replacement text only)
CONTENT=""
if [ "$HOOK_TOOL_NAME" = "Write" ]; then
  CONTENT="$(json_get "$INPUT" '.tool_input.content')"
else
  CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"
fi

if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no content to check"
fi

# The check: look for `// YYYY-MM-DD`, `# YYYY-MM-DD`, `/* YYYY-MM-DD`, or
# `* YYYY-MM-DD` patterns in the content. Year range 2020-2099 to avoid
# matching version strings like "2.0.1-rc1" or path segments like "v1-20".
TIMESTAMP_REGEX='(//|#|/\*|\*)[[:space:]]+20[2-9][0-9]-[01][0-9]-[0-3][0-9]'

if printf '%s' "$CONTENT" | grep -qE "$TIMESTAMP_REGEX"; then
  # Extract the first matching line for the error message — agents
  # appreciate the specific offending text more than a generic rule cite.
  OFFENDING="$(printf '%s' "$CONTENT" | grep -nE "$TIMESTAMP_REGEX" | head -1)"
  verdict_block "$HOOK_ID" "Code Has No Time Stamps (IRON LAW): found '$OFFENDING' in $FILE_PATH.
Timestamps in code drift the moment the code is reviewed/merged/rebased.
Use a relative reference ('during the 2026-Q2 refactor'), a ticket ID
('PROJ-123 cleanup'), or omit the date entirely. Bypass:
HOOK_BYPASS_CODE_NO_TIMESTAMPS=1 (use sparingly — generated banners only)."
fi

verdict_allow "$HOOK_ID" "no timestamps in content"
