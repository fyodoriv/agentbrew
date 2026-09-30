#!/bin/bash
# agentbrew/hooks/checks/tests-adapt-to-production.sh
#
# **Hook**: tests-adapt-to-production
# **Event**: PostToolUse on Write|Edit (production code only, NOT tests)
# **Verdict**: block
# **Source rule**: shared-rules.md:343 "Tests Adapt to Production, Not the Other Way Around (IRON LAW)"
#
# Blocks diffs that add test-accommodation wrappers in production code:
# functions named `lookup*Spy`, `defer*Until`, `wrap*ForTest`, `*ForTesting`,
# `*Mock`, `__test*` etc. that exist solely so tests can mock / poke the
# internals. Production code should be designed for production semantics;
# tests should adapt to it (via dependency injection at the boundary,
# spy libraries, or rewriting the test).
#
# **What gets blocked**:
#   - Diff in `src/foo.ts` adds `export const lookupForTest = () => ...`
#   - Diff in `src/api.ts` adds `function deferUntilTest()`
#   - Diff in `src/state.ts` adds `__testReset()` exported function
#
# **What does NOT get blocked**:
#   - Same diff in `src/foo.test.ts` (test files can do anything)
#   - Diff in `src/__tests__/*` directory
#   - DI boundary: function named `inject*Dependency` that has a clear
#     non-test caller too — heuristic skips when the same diff calls the
#     function from a non-test path
#
# **Bypass**: `HOOK_BYPASS_TESTS_ADAPT_TO_PRODUCTION=1` for the rare
# legitimate test-only hook (e.g. a `__resetForTest` in a stateful
# module where there's no cleaner option).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="tests-adapt-to-production"

if [ "${HOOK_BYPASS_TESTS_ADAPT_TO_PRODUCTION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_TESTS_ADAPT_TO_PRODUCTION=1"
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

# Skip: this hook only fires on PRODUCTION code (not tests)
case "$FILE_PATH" in
  *.test.*|*.spec.*|*/__tests__/*|*/tests/*|*/test/*|*.bats)
    verdict_bypass "$HOOK_ID" "$FILE_PATH is a test file (out of scope)"
    ;;
esac

# Also skip non-code files
case "$FILE_PATH" in
  *.md|*.markdown|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock)
    verdict_bypass "$HOOK_ID" "$FILE_PATH not a code file"
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

# Detect test-accommodation wrapper patterns
# These are exported function / const names that only make sense for tests
WRAPPER_REGEX='\b(export[[:space:]]+(const|function|let|var)[[:space:]]+|function[[:space:]]+|const[[:space:]]+|let[[:space:]]+)([a-zA-Z_]*ForTest[a-zA-Z_]*|[a-zA-Z_]*ForTesting[a-zA-Z_]*|__test[A-Z][a-zA-Z_]*|lookup[A-Z][a-zA-Z_]*Spy|defer[A-Z][a-zA-Z_]*Until|wrap[A-Z][a-zA-Z_]*ForTest|[a-zA-Z_]*Mock[A-Z][a-zA-Z_]*)\b'

if printf '%s' "$CONTENT" | grep -qE "$WRAPPER_REGEX"; then
  OFFENDING="$(printf '%s' "$CONTENT" | grep -nE "$WRAPPER_REGEX" | head -1)"
  verdict_block "$HOOK_ID" "Tests Adapt to Production, Not the Other Way Around (IRON LAW): found test-accommodation wrapper in $FILE_PATH at '$OFFENDING'.
Production code should not contain *ForTest / __test* / lookup*Spy / wrap*ForTest functions. Refactor:
  (a) Use dependency injection at the function/class boundary (inject the dependency in the constructor or as an arg)
  (b) Use a spy library in the test instead (sinon, vi.spyOn, vi.mock)
  (c) Rewrite the test to use the production API + assert on observable behavior
Bypass: HOOK_BYPASS_TESTS_ADAPT_TO_PRODUCTION=1 (rare — for genuinely necessary __resetForTest in stateful modules)."
fi

verdict_allow "$HOOK_ID" "no test-accommodation wrappers in diff"
