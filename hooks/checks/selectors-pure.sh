#!/bin/bash
# agentbrew/hooks/checks/selectors-pure.sh
#
# **Hook**: selectors-pure
# **Event**: PreToolUse on Write|Edit
# **Verdict**: block
# **Source rule**: shared-rules.md:368 "Selectors Must Be Pure (IRON LAW)"
#
# Blocks Write|Edit to Redux/RTK selector files (`*.selector.ts`,
# `*.selectors.ts`, files under `selectors/` directory) that introduce
# impure operations: `Date.now()`, `fetch()`, `Math.random()`, network
# calls, side effects. Selectors must be pure functions of state so
# `createSelector` memoization works + re-render cycles stay
# predictable.
#
# **What gets blocked**:
#   - Write/Edit to `userSelectors.ts` that adds `Date.now()`
#   - Write/Edit to `state.selectors.ts` that adds `fetch(...)`
#   - Edit to file under `selectors/` adding `Math.random()`
#
# **What does NOT get blocked**:
#   - Selectors using pure operations (Object.values, map, filter, etc.)
#   - Non-selector files using Date.now / fetch (irrelevant scope)
#   - Test files (*.test.ts, *.spec.ts) — tests can mock anything
#
# **Bypass**: `HOOK_BYPASS_SELECTORS_PURE=1` for the rare case where
# impurity IS the design (e.g. a deliberately-non-memoized "freshness"
# selector that's been reviewed + documented).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="selectors-pure"

if [ "${HOOK_BYPASS_SELECTORS_PURE:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_SELECTORS_PURE=1"
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

# Only fire on selector files
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx)
    verdict_bypass "$HOOK_ID" "test file — mocking allowed"
    ;;
  *.selector.ts|*.selector.tsx|*.selectors.ts|*.selectors.tsx|*selectors/*)
    : # in scope — continue
    ;;
  *)
    verdict_bypass "$HOOK_ID" "not a selector file"
    ;;
esac

# Get content to check (Write: full content; Edit: new_string)
CONTENT=""
if [ "$HOOK_TOOL_NAME" = "Write" ]; then
  CONTENT="$(json_get "$INPUT" '.tool_input.content')"
else
  CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"
fi

if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no content"
fi

# Check for impure operations
IMPURE_REGEX='\b(Date\.now|Math\.random|fetch|XMLHttpRequest|axios|navigator\.|window\.location|document\.cookie|localStorage|sessionStorage)\b'

if printf '%s' "$CONTENT" | grep -qE "$IMPURE_REGEX"; then
  OFFENDING="$(printf '%s' "$CONTENT" | grep -nE "$IMPURE_REGEX" | head -1)"
  verdict_block "$HOOK_ID" "Selectors Must Be Pure (IRON LAW): found impure operation in $FILE_PATH at '$OFFENDING'.
Selectors must be pure functions of state so createSelector memoization works + re-renders stay predictable. Move the impure operation to a thunk, listener, or component effect. Bypass: HOOK_BYPASS_SELECTORS_PURE=1 (only for documented non-memoized selectors)."
fi

verdict_allow "$HOOK_ID" "selector is pure"
