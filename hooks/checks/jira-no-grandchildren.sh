#!/bin/bash
# agentbrew/hooks/checks/jira-no-grandchildren.sh
#
# **Hook**: jira-no-grandchildren
# **Event**: PreToolUse on mcp__jira-mcp__* (any tool call that creates a Jira issue)
# **Verdict**: block
# **Source rule**: shared-rules.md:1044 "Jira Hierarchy: No Grandchildren of an Epic (IRON LAW)"
#
# Blocks Jira issue creation that would create a 3-level hierarchy
# (Epic → Story/Task → Sub-task). The rule enforces a flat hierarchy:
# Epic at the top, Story/Task as direct children, never grandchildren.
# Sub-tasks under Stories/Tasks become invisible in epic-level reports.
#
# **What gets blocked**:
#   - `mcp__jira-mcp__create_issue` with `issueType: Sub-task` and `parent: <a Story>` → block
#   - `mcp__jira-mcp__create_subtask` with `parentKey: PROJ-XXX` where PROJ-XXX is a Story → block
#
# **What does NOT get blocked**:
#   - Creating Story / Task with `parent: <Epic>` (correct shape)
#   - Creating Story / Task with no parent (allowed for standalone work)
#   - Editing an existing Sub-task (the violation already happened)
#
# **Implementation note**: this is a heuristic — the hook can't query
# Jira to verify the parent's actual issue type. It pattern-matches on
# the MCP tool name + arguments. The runtime Jira API rejects truly
# invalid parents anyway; this hook catches the obvious "subtask of
# a story" anti-pattern at the agent's intent level.
#
# **Bypass**: `HOOK_BYPASS_JIRA_NO_GRANDCHILDREN=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="jira-no-grandchildren"

if [ "${HOOK_BYPASS_JIRA_NO_GRANDCHILDREN:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_JIRA_NO_GRANDCHILDREN=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

# Only fire on jira-mcp tool calls that create issues
case "$HOOK_TOOL_NAME" in
  mcp__jira-mcp__create_issue|mcp__jira-mcp__create_subtask|mcp__atlassian__createJiraIssue|mcp__atlassian__createSubtask)
    : # in scope
    ;;
  *)
    verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not a jira create-issue MCP call"
    ;;
esac

# Get the issue type and parent
ISSUE_TYPE=$(json_get "$INPUT" '.tool_input.issueType // .tool_input.issue_type // .tool_input.type // ""')
PARENT=$(json_get "$INPUT" '.tool_input.parent // .tool_input.parentKey // .tool_input.parent_key // ""')

# Sub-task without explicit parent is suspicious but not necessarily wrong
if [ -z "$PARENT" ]; then
  verdict_bypass "$HOOK_ID" "no parent specified (standalone or attached via different field)"
fi

# Sub-task creation under non-Epic = grandchild violation
case "$ISSUE_TYPE" in
  "Sub-task"|"Subtask"|"sub-task"|"subtask"|"SUBTASK")
    # Without a Jira API query, we can't tell if the parent is an Epic
    # or a Story. The convention at organization: Stories typically have
    # numeric suffixes; Epics typically have lower numbers OR are
    # explicitly tagged as Epic in the agent's prior tool calls.
    # Safer default: WARN that the agent should verify the parent is
    # an Epic before creating the subtask.
    verdict_block "$HOOK_ID" "Jira Hierarchy: No Grandchildren (IRON LAW): about to create Sub-task with parent $PARENT. Sub-tasks are only allowed under Epics — never under Stories/Tasks (creates a 3-level hierarchy that breaks epic-level reporting).
If $PARENT is an Epic, the correct shape is to create a Story/Task with parent: $PARENT, not a Sub-task. If $PARENT is a Story, this Sub-task should instead be a separate Story under the Epic that owns $PARENT.
Bypass: HOOK_BYPASS_JIRA_NO_GRANDCHILDREN=1 (only after manual confirmation that $PARENT is an Epic AND the Sub-task type is correct)."
    ;;
esac

verdict_allow "$HOOK_ID" "issue type '$ISSUE_TYPE' not a sub-task"
