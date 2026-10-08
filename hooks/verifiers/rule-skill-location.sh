#!/bin/bash
# agentbrew/hooks/verifiers/rule-skill-location.sh
#
# **Hook**: rule-skill-location
# **Event**: PreToolUse on Write|Edit
# **Verdict**: warn (Cat B verifier observation mode)
# **Source rule**: templates/AGENTS.md:13 "Where new rules and skills belong"
# **Bypass**: `HOOK_BYPASS_RULE_SKILL_LOCATION=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"
source "$__HOOK_LIB_DIR/claude-verifier.sh"

readonly HOOK_ID="rule-skill-location"
export HOOK_MODEL="${HOOK_MODEL:-claude-haiku-4-5}"
export HOOK_VERIFIER_TIMEOUT="${HOOK_VERIFIER_TIMEOUT:-2}"
export HOOK_PROMPT_VERSION="1"

if [ "${HOOK_BYPASS_RULE_SKILL_LOCATION:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_RULE_SKILL_LOCATION=1"
fi

INPUT="$(read_hook_stdin)"
TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
case "$TOOL_NAME" in
  Write|Edit|MultiEdit) ;;
  *) verdict_bypass "$HOOK_ID" "tool $TOOL_NAME is not Write/Edit/MultiEdit" ;;
esac

FILE_PATH="$(json_get "$INPUT" '.tool_input.file_path')"
if [ -z "$FILE_PATH" ]; then
  verdict_bypass "$HOOK_ID" "no file path"
fi

is_rule_or_skill_path() {
  local path="$1"
  case "$path" in
    *SKILL.md|*/skills/*|*/skill-plugins/*|*/.agents/skills/*|*/.claude/skills/*) return 0 ;;
    *AGENTS.md|*CLAUDE.md|*shared-rules.md|*/rules/*.md|*/rules/*.mdc|*/.cursor/rules/*|*/.config/agentbrew/rules/*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_rule_or_skill_path "$FILE_PATH"; then
  verdict_bypass "$HOOK_ID" "path is not a rule or skill surface"
fi

CONTENT="$(json_get "$INPUT" '.tool_input.content')"
if [ -z "$CONTENT" ]; then CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"; fi
if [ -z "$CONTENT" ]; then
  CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.edits // empty | tostring' 2>/dev/null || true)"
fi
CONTENT_EXCERPT="$(printf '%s' "$CONTENT" | head -c 12000)"

VERIFIER_PROMPT='You are a strict rule/skill routing verifier. Judge whether the proposed file path is the right canonical home for the content. Routing matrix: rules that apply to every task in every repo belong in shared-rules.md; recurring workflows across repos belong in an agentbrew skill under skill-plugins/dev/; one team stack or product area belongs in that team skill registry; one specific tool/dashboard/release process belongs in that tool plugin skills folder; one specific repo belongs in that repo AGENTS.md or .agents/skills/; language/file-pattern rules belong in per-file rules with globs metadata. BLOCK only when the path is clearly wrong for the described scope. ALLOW ambiguity, local repo-specific content in repo files, or edits to existing files that do not introduce new routing scope. Respond with EXACTLY one word: ALLOW or BLOCK, then a brief reason and the better location if blocked.'

VERDICT="$(verify_with_claude "$VERIFIER_PROMPT" "$(cat <<EOF
Proposed file path:
$FILE_PATH

Content excerpt:
$CONTENT_EXCERPT
EOF
)")"

if [[ "$VERDICT" =~ ^BLOCK ]]; then
  verdict_warn "$HOOK_ID" "Proposed rule/skill location may not match the routing matrix. Move or rewrite it into the canonical home before continuing. Verifier: ${VERDICT#BLOCK }"
fi

verdict_allow "$HOOK_ID" "rule/skill path matches routing matrix or verifier default-allowed: $VERDICT"
