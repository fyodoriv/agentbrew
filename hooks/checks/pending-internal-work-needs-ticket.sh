#!/bin/bash
# agentbrew/hooks/checks/pending-internal-work-needs-ticket.sh
#
# **Hook**: pending-internal-work-needs-ticket
# **Event**: PostToolUse on Write|Edit
# **Verdict**: warn (don't block — many TODOs are legitimately ad-hoc)
# **Source rule**: shared-rules.md:1063 "Pending Internal Work Must Be Tracked (IRON LAW)"
#
# When a Write/Edit adds a TODO/FIXME/HACK/XXX comment in code, warn if
# the comment lacks a Jira-style ticket reference (PROJ-XXX). The rule's intent: every committed
# TODO has an owner + a tracking artifact — otherwise it rots forever.
#
# **What triggers a warning**:
#   - Diff adds `// TODO: fix the foo`
#   - Diff adds `# FIXME: handle the empty case`
#   - Diff adds `# HACK: until we figure out why`
#
# **What does NOT trigger**:
#   - Diff adds `// TODO(PROJ-123): clean up after Phase 3 lands` (has ticket)
#   - Diff adds `// TODO @alice: review with team` (has owner)
#   - Tests or markdown files (excluded from scope)
#
# This is a WARN — not block — because:
#   (a) the legitimate use case (genuinely ad-hoc TODO in active code) is
#       common enough that blocking would be a high false-positive rate
#   (b) the warning surfaces the rule to the agent + logs to decision JSON;
#       cron auto-heal can later sweep + file P3 tasks for accumulated TODOs
#
# **Bypass**: `HOOK_BYPASS_PENDING_INTERNAL_WORK_NEEDS_TICKET=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="pending-internal-work-needs-ticket"

if [ "${HOOK_BYPASS_PENDING_INTERNAL_WORK_NEEDS_TICKET:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_PENDING_INTERNAL_WORK_NEEDS_TICKET=1"
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

# Scope: code files only — skip tests / docs / configs
case "$FILE_PATH" in
  *.test.*|*.spec.*|*/__tests__/*|*/tests/*|*.md|*.markdown|*.txt|*.json|*.yaml|*.yml|*.toml|*TASKS.md|*CHANGELOG*)
    verdict_bypass "$HOOK_ID" "$FILE_PATH out of scope (test/docs/config)"
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

# Look for TODO/FIXME/HACK/XXX patterns (in code comments)
TODO_PATTERN='\b(TODO|FIXME|HACK|XXX)\b'

if ! printf '%s' "$CONTENT" | grep -qE "$TODO_PATTERN"; then
  verdict_allow "$HOOK_ID" "no TODO/FIXME/HACK/XXX in diff"
fi

# Found a TODO — check if it has a ticket / owner reference
HAS_TICKET=$(printf '%s' "$CONTENT" | grep -cE '\b[A-Z][A-Z0-9]+-[0-9]+\b' || true)
HAS_OWNER=$(printf '%s' "$CONTENT" | grep -cE 'TODO[[:space:]]*[\(@][^)]*[\)]?' || true)

if [ "$HAS_TICKET" = "0" ] && [ "$HAS_OWNER" = "0" ]; then
  OFFENDING="$(printf '%s' "$CONTENT" | grep -nE "$TODO_PATTERN" | head -1)"
  verdict_warn "$HOOK_ID" "Pending Internal Work Must Be Tracked (IRON LAW): found '$OFFENDING' in $FILE_PATH without a ticket reference.
Add a ticket ID: \`// TODO(PROJ-123): \` or an owner: \`// TODO @alice: \`. Bare TODOs rot forever. Bypass: HOOK_BYPASS_PENDING_INTERNAL_WORK_NEEDS_TICKET=1."
fi

verdict_allow "$HOOK_ID" "TODO has ticket or owner reference"
