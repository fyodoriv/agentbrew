#!/bin/bash
# agentbrew/hooks/checks/skill-names-user-facing-verbs.sh
#
# **Hook**: skill-names-user-facing-verbs
# **Event**: PreToolUse on Write|Edit
# **Verdict**: block
# **Source rule**: shared-rules.md:759 "Skill Names Are User-Facing Verbs, Not Internal Jargon (IRON LAW)"
#
# Blocks Write|Edit to a `SKILL.md` whose `name:` frontmatter field
# contains internal jargon (acronyms, project codenames, vendor names,
# implementation details). Skill names are how the AGENT decides which
# skill to invoke — a name like `acme-config-loader` requires the agent
# to know what a project acronym means; `understand-workspace-configuration` is the
# verb-first phrasing the agent can actually match against intent.
#
# **What gets blocked**:
#   - Write `~/.claude/skills/domain-jargon-loader/SKILL.md` with `name: domain-jargon-loader`
#   - Edit `name:` field to `domain-jargon-runner`
#   - Edit `name:` field to `workspace-bridge-mod`
#
# **What does NOT get blocked**:
#   - `name: configure` (a verb)
#   - `name: review-pr` (verb-noun)
#   - `name: load-project-context` (verb phrase)
#   - Non-SKILL.md files
#   - Edit that doesn't touch the `name:` line
#
# **Bypass**: `HOOK_BYPASS_SKILL_NAMES_USER_FACING_VERBS=1`
#
# **Configuration** (all optional):
#   - SKILL_NAMES_JARGON_TERMS: extra `|`-separated jargon terms (for example
#     `acme|zeta`) added to the small generic default set. An org overlay
#     can export this.
#   - SKILL_NAMES_ORG_REPO_REGEX: ERE matched against the SKILL.md path.
#     Skills under matching paths keep their domain vocabulary and skip the
#     check. Empty by default (the check applies everywhere).
#   - SKILL_NAMES_ENFORCE_IN_ORG_REPOS=1: ignore the path regex and check
#     everywhere.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="skill-names-user-facing-verbs"

# Anti-pattern dictionary: generic jargon markers, plus any terms the
# operator or org overlay adds through SKILL_NAMES_JARGON_TERMS.
JARGON_TERMS="domain-jargon"
if [ -n "${SKILL_NAMES_JARGON_TERMS:-}" ]; then
  JARGON_TERMS="$JARGON_TERMS|$SKILL_NAMES_JARGON_TERMS"
fi
readonly JARGON_REGEX="\b($JARGON_TERMS)\b"

if [ "${HOOK_BYPASS_SKILL_NAMES_USER_FACING_VERBS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_SKILL_NAMES_USER_FACING_VERBS=1"
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

# Only fire on SKILL.md files
case "$FILE_PATH" in
  */SKILL.md|*/skill.md)
    : # continue
    ;;
  *)
    verdict_bypass "$HOOK_ID" "$FILE_PATH not a SKILL.md"
    ;;
esac

# Repos that own their domain vocabulary can opt out through
# SKILL_NAMES_ORG_REPO_REGEX. Unset means no path is skipped.
ORG_REPO_PATH_REGEX="${SKILL_NAMES_ORG_REPO_REGEX:-}"
if [ -n "$ORG_REPO_PATH_REGEX" ] && [ "${SKILL_NAMES_ENFORCE_IN_ORG_REPOS:-0}" != "1" ]; then
  if printf '%s' "$FILE_PATH" | grep -qE "$ORG_REPO_PATH_REGEX"; then
    verdict_bypass "$HOOK_ID" "$FILE_PATH matches SKILL_NAMES_ORG_REPO_REGEX (domain naming allowed)"
  fi
fi

CONTENT=""
if [ "$HOOK_TOOL_NAME" = "Write" ]; then
  CONTENT="$(json_get "$INPUT" '.tool_input.content')"
else
  CONTENT="$(json_get "$INPUT" '.tool_input.new_string')"
fi

if [ -z "$CONTENT" ]; then
  verdict_bypass "$HOOK_ID" "no content"
fi

# Extract the `name:` line (in YAML frontmatter)
NAME_VALUE=$(printf '%s' "$CONTENT" | grep -iE '^name:' | head -1 | sed 's/^name:[[:space:]]*//' | tr -d '"' | tr -d "'" || true)

if [ -z "$NAME_VALUE" ]; then
  verdict_bypass "$HOOK_ID" "no name: field in diff"
fi

# Check for jargon
if printf '%s' "$NAME_VALUE" | grep -qiE "$JARGON_REGEX"; then
  MATCH=$(printf '%s' "$NAME_VALUE" | grep -oiE "$JARGON_REGEX" | head -1)
  verdict_block "$HOOK_ID" "Skill Names Are User-Facing Verbs (IRON LAW): name '$NAME_VALUE' in $FILE_PATH contains internal jargon '$MATCH'.
Skill names are how the AGENT decides which skill to invoke. Rephrase as a verb the agent (and a new operator) can match against intent:
  - 'acme-loader' → 'understand-workspace-configuration'
  - 'domain-jargon-runner' → 'run-domain-process'
Bypass: HOOK_BYPASS_SKILL_NAMES_USER_FACING_VERBS=1."
fi

verdict_allow "$HOOK_ID" "skill name is jargon-free"
