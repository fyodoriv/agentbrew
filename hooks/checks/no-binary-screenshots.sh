#!/bin/bash
# agentbrew/hooks/checks/no-binary-screenshots.sh
#
# **Hook**: no-binary-screenshots
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: templates/AGENTS.md:370 "Never Commit Screenshots to Repos (IRON LAW)"
#                  + templates/AGENTS.md:396 "Don't Screenshot Test Output (IRON LAW)"
#
# Blocks `git add` of PNG/JPG/JPEG/GIF/WEBP/BMP files outside the
# `__storyshots__/` storybook visual-regression baseline directory.
# Binary screenshots committed to source control compound: 200 PNGs at
# 200KB each = 40MB of dead weight in every clone, forever. The
# canonical alternative is a transient file in /tmp + a link in the PR
# body (GitHub hosts the image once uploaded; the repo stays clean).
#
# **What gets blocked**:
#   - `git add foo.png`
#   - `git add screenshots/dashboard.jpg`
#   - `git add docs/error.gif`
#
# **What does NOT get blocked**:
#   - `git add **/__storyshots__/*.png` — storybook visual baselines
#   - `git add docs/architecture.svg` — SVG is text, not a binary screenshot
#   - `git add public/favicon.png` — root-level brand assets (small + stable)
#   - `git add fixtures/test-image.png` — test data tied to a `.test.` neighbor
#
# **Bypass**: `HOOK_BYPASS_NO_BINARY_SCREENSHOTS=1` for legitimate brand
# assets / fixtures that aren't covered by the path heuristics above.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-binary-screenshots"

if [ "${HOOK_BYPASS_NO_BINARY_SCREENSHOTS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_BINARY_SCREENSHOTS=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command"
fi

# Only fire on git add
if ! printf '%s' "$COMMAND" | grep -qE '\bgit[[:space:]]+add\b'; then
  verdict_bypass "$HOOK_ID" "not git add"
fi

# Extract candidate file args from the command — everything after "git add"
# minus flags. Heuristic but covers 99% of real invocations.
ARGS=$(printf '%s' "$COMMAND" | sed -nE 's/.*git[[:space:]]+add[[:space:]]+(.*)/\1/p' | head -1)
if [ -z "$ARGS" ]; then
  verdict_bypass "$HOOK_ID" "no args after git add"
fi

# Binary image extensions
BINARY_REGEX='\.(png|jpg|jpeg|gif|webp|bmp)(\b|$|[[:space:]])'

if ! printf '%s' "$ARGS" | grep -qiE "$BINARY_REGEX"; then
  verdict_allow "$HOOK_ID" "no binary image extensions in add args"
fi

# Found at least one binary extension — check if every match is exempt
# (storyshots, favicon, fixtures with adjacent .test., or path includes
# /public/ /docs/ for brand assets).
BLOCKED_FILES=""
while IFS= read -r file; do
  # Skip if path indicates an exempt location
  case "$file" in
    *__storyshots__/*|*/__storyshots__/*) continue ;;  # storybook baselines
    *favicon*|*/favicon*) continue ;;                   # brand assets
    *fixtures/*|*/fixtures/*) continue ;;               # test fixtures
    *snapshots/*|*/snapshots/*) continue ;;             # jest/vitest snapshots
  esac
  if printf '%s' "$file" | grep -qiE "$BINARY_REGEX"; then
    BLOCKED_FILES="$BLOCKED_FILES $file"
  fi
done <<EOF
$(printf '%s\n' "$ARGS" | tr ' ' '\n' | grep -v '^-')
EOF

if [ -n "$BLOCKED_FILES" ]; then
  verdict_block "$HOOK_ID" "Binary screenshots committed to repo compound forever (200 PNGs × 200KB = 40MB in every clone). Blocked files:$BLOCKED_FILES.
Canonical alternative: upload to GitHub via the PR body (drag-drop image into the body editor; GitHub hosts it). For storybook visual baselines, put under \`__storyshots__/\`. Bypass: HOOK_BYPASS_NO_BINARY_SCREENSHOTS=1."
fi

verdict_allow "$HOOK_ID" "all binary images exempt-located"
