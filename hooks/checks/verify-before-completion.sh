#!/bin/bash
# agentbrew/hooks/checks/verify-before-completion.sh
#
# **Hook**: verify-before-completion
# **Event**: Stop
# **Verdict**: block
# **Source rule**: shared-rules.md:231 "Verify Before Completion (IRON LAW)"
#
# At the end of every agent turn (Stop event), check the transcript for
# evidence that verification was actually run. If the agent modified code
# files (Write/Edit on *.ts/.tsx/.js/.jsx/.py/.sh) but never invoked a
# verify command (npm test / npx vitest / tsc / npm run build /
# npm run verify / pytest / shellcheck), BLOCK the Stop — the agent
# can't claim "done" without empirical proof.
#
# **What gets blocked**:
#   - Agent edits 3 .ts files, never runs `tsc` or tests, tries to Stop → block
#   - Agent rewrites a Python module, never runs pytest → block
#   - Agent updates a bash script, never runs `shellcheck` or `bats` → block
#
# **What does NOT get blocked**:
#   - Read-only sessions (no Write/Edit calls)
#   - Pure docs / markdown sessions (no code-shaped files touched)
#   - Sessions where the agent ran at least ONE verify command per modified
#     file category
#
# **Bypass**: `HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1` for the genuinely
# read-only sessions that the heuristic miscategorizes (rare). Or
# explicitly skip with `MINSKY_PIPELINE=1` for orchestrator-driven runs
# that have their own verify gate downstream.
#
# **Heuristic**: parses the transcript JSONL file for tool_use entries.
# Counts Write/Edit on code files vs verify command invocations. Best-
# effort — false negatives (allowed when shouldn't be) are preferable to
# false positives (blocked legitimate work). Cron-wired auto-heal could
# tighten this later.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="verify-before-completion"

if [ "${HOOK_BYPASS_VERIFY_BEFORE_COMPLETION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1"
fi
if [ -n "${MINSKY_PIPELINE:-}" ]; then
  verdict_bypass "$HOOK_ID" "MINSKY_PIPELINE=1 — orchestrator-owned verify"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"

# Only fire on Stop event
if [ "$HOOK_EVENT_NAME" != "Stop" ]; then
  verdict_bypass "$HOOK_ID" "not a Stop event"
fi

TRANSCRIPT_PATH="$(json_get "$INPUT" '.transcript_path')"
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  verdict_bypass "$HOOK_ID" "no transcript path (best-effort)"
fi

# Count code-file edits in this turn. Transcript JSONL: each line is an
# event; tool_use events for Edit/Write have tool_input.file_path. We
# count files matching code-shaped extensions.
CODE_EDITS=$(jq -r 'select(.message.content[]?.type == "tool_use" and (.message.content[].name == "Write" or .message.content[].name == "Edit"))
  | .message.content[] | select(.type == "tool_use" and (.name == "Write" or .name == "Edit"))
  | .input.file_path // empty' "$TRANSCRIPT_PATH" 2>/dev/null \
  | grep -cE '\.(ts|tsx|js|jsx|py|sh|go|rs|java|rb|cpp|c|h)$' || true)

if [ "$CODE_EDITS" = "0" ] || [ -z "$CODE_EDITS" ]; then
  verdict_bypass "$HOOK_ID" "no code-file edits this turn (CODE_EDITS=$CODE_EDITS)"
fi

# Count verify command invocations. tool_use Bash events with commands
# matching test / typecheck / lint / build patterns.
VERIFY_CMDS=$(jq -r 'select(.message.content[]?.type == "tool_use" and .message.content[].name == "Bash")
  | .message.content[] | select(.type == "tool_use" and .name == "Bash")
  | .input.command // empty' "$TRANSCRIPT_PATH" 2>/dev/null \
  | grep -cE '\b(npm|yarn|pnpm)[[:space:]]+(test|run[[:space:]]+(test|verify|build|lint|typecheck))\b|\bnpx[[:space:]]+(vitest|jest|tsc|biome)\b|\btsc[[:space:]]*--noEmit\b|\bpytest\b|\bshellcheck\b|\bbats\b|\bgo[[:space:]]+test\b|\bcargo[[:space:]]+(test|check)\b' || true)

if [ -z "$VERIFY_CMDS" ]; then
  VERIFY_CMDS=0
fi

if [ "$VERIFY_CMDS" = "0" ]; then
  verdict_block "$HOOK_ID" "Verify Before Completion (IRON LAW): turn modified $CODE_EDITS code file(s) but ran ZERO verify commands. Run at least one of: \`npm test\`, \`npm run verify\`, \`npx vitest run\`, \`npx tsc --noEmit\`, \`pytest\`, \`shellcheck\` — whichever fits the project. The agent is probabilistic; deterministic checks are the only guarantee work doesn't regress. Bypass: HOOK_BYPASS_VERIFY_BEFORE_COMPLETION=1 (use sparingly — only for genuinely read-only turns the heuristic miscategorizes)."
fi

verdict_allow "$HOOK_ID" "verified ($VERIFY_CMDS verify cmd(s) for $CODE_EDITS code edit(s))"
