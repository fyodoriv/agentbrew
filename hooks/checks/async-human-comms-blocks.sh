#!/bin/bash
# agentbrew/hooks/checks/async-human-comms-blocks.sh
#
# **Hook**: async-human-comms-blocks
# **Event**: PreToolUse (any tool)
# **Verdict**: block
# **Source rule**: shared-rules.md:135 "Async human comms — ask_human.md (ADOPTED CONVENTION, IRON LAW)"
#
# When the current repo has an `ask_human.md` file at root with a
# `status: PENDING` field in YAML frontmatter, BLOCK all non-read tool
# calls until the agent acknowledges the pending question.
#
# The async human comms protocol: the agent writes its question to
# `ask_human.md` with `status: PENDING`, the user answers later, the
# agent reads the answer + sets `status: RESOLVED`. While PENDING, the
# agent should NOT proceed with work that depends on the answer —
# this hook enforces that hard.
#
# **What gets blocked**:
#   - Bash, Write, Edit, mcp__github__*, etc. — all tools that mutate
#   - The first PreToolUse hook fires when ask_human.md status=PENDING
#
# **What does NOT get blocked**:
#   - Read tools (Read, Grep, Glob) — those are fine, agent might be reading the user's answer
#   - Write|Edit to ask_human.md itself — agent updating the file
#   - When no ask_human.md exists OR status != PENDING
#
# **Bypass**: `HOOK_BYPASS_ASYNC_HUMAN_COMMS_BLOCKS=1` for the rare
# case the agent legitimately needs to proceed without waiting (e.g.
# urgent rollback while user is offline).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="async-human-comms-blocks"

if [ "${HOOK_BYPASS_ASYNC_HUMAN_COMMS_BLOCKS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_ASYNC_HUMAN_COMMS_BLOCKS=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Read tools are allowed
case "$HOOK_TOOL_NAME" in
  Read|Grep|Glob|TodoWrite|NotebookRead)
    verdict_bypass "$HOOK_ID" "read-only tool $HOOK_TOOL_NAME (always allowed)"
    ;;
esac

# Edit/Write to ask_human.md itself is allowed (agent updating the file)
FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"
case "$FILE_PATH" in
  */ask_human.md|*/ASK_HUMAN.md)
    verdict_bypass "$HOOK_ID" "writing ask_human.md itself (always allowed)"
    ;;
esac

# Find ask_human.md by walking up from cwd
CWD=$(pwd)
ASK_HUMAN_FILE=""
SEARCH_DIR="$CWD"
for _ in 1 2 3 4 5; do
  if [ -f "$SEARCH_DIR/ask_human.md" ]; then
    ASK_HUMAN_FILE="$SEARCH_DIR/ask_human.md"
    break
  fi
  PARENT=$(dirname "$SEARCH_DIR")
  if [ "$PARENT" = "$SEARCH_DIR" ] || [ "$PARENT" = "/" ]; then
    break
  fi
  SEARCH_DIR="$PARENT"
done

if [ -z "$ASK_HUMAN_FILE" ]; then
  verdict_bypass "$HOOK_ID" "no ask_human.md in cwd or ancestors"
fi

# Check if status is PENDING. grep exits 1 when no status line — with pipefail that
# aborts before verdict_bypass and Claude Code reports "non-blocking status code:
# No stderr output" on every tool call (v2.1.178+).
STATUS=""
if grep -qiE '^status:' "$ASK_HUMAN_FILE" 2>/dev/null; then
  STATUS=$(grep -iE '^status:' "$ASK_HUMAN_FILE" 2>/dev/null | head -1 | sed 's/^status:[[:space:]]*//I' | tr -d '"' | tr -d "'" | awk '{print $1}' || true)
fi

if [ -z "$STATUS" ] || [ "$STATUS" != "PENDING" ]; then
  verdict_bypass "$HOOK_ID" "ask_human.md status=$STATUS (not PENDING)"
fi

verdict_block "$HOOK_ID" "Async Human Comms (IRON LAW): $ASK_HUMAN_FILE has status: PENDING. Wait for the user's answer before proceeding with tool $HOOK_TOOL_NAME.
Read the file: \`cat $ASK_HUMAN_FILE\`. When the user updates it with their answer, set status: RESOLVED and retry. Bypass: HOOK_BYPASS_ASYNC_HUMAN_COMMS_BLOCKS=1 (only for urgent rollback while user is offline)."
