#!/bin/bash
# agentbrew/hooks/checks/env-correct-urls.sh
#
# **Hook**: env-correct-urls
# **Event**: PreToolUse on Bash (gh pr create / gh pr edit / gh issue create)
# **Verdict**: warn (block-by-default risk too high — env contexts overlap legitimately)
# **Source rule**: shared-rules.md:811 "Env-Correct URLs (IRON LAW)"
#
# Warns when a PR body references an URL for one environment but the PR
# context implies a different environment. Common cases:
#   - PR title mentions "staging" but body has `app.example.com` (PROD)
#   - PR title mentions "PROD" / "production" but body has `staging.app.example.com`
#
# Reviewers shouldn't have to mentally translate URLs to figure out
# which env the PR is about. Catches the canonical "shipped to wrong
# env" failure mode early.
#
# **What triggers a warning**:
#   - Title says "staging rollback" but body links `https://app.example.com/foo`
#   - Title says "PROD deploy" but body links `https://staging.app.example.com/`
#
# **What does NOT trigger**:
#   - Title + body env match
#   - No env keyword in title (just "fix the foo")
#   - Body has both envs (legitimate cross-env reference)
#
# **Bypass**: `HOOK_BYPASS_ENV_CORRECT_URLS=1`

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="env-correct-urls"

if [ "${HOOK_BYPASS_ENV_CORRECT_URLS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_ENV_CORRECT_URLS=1"
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

# Only fire on gh pr/issue create/edit
if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+(pr|issue)[[:space:]]+(create|edit)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr/issue create/edit"
fi

# Determine the env keyword in title (case-insensitive)
TITLE_ENV=""
if printf '%s' "$COMMAND" | grep -qiE '\-\-title[[:space:]]+["\047][^"\047]*\b(staging|stage|preprod)\b'; then
  TITLE_ENV="staging"
elif printf '%s' "$COMMAND" | grep -qiE '\-\-title[[:space:]]+["\047][^"\047]*\b(prod|production)\b'; then
  TITLE_ENV="prod"
fi

if [ -z "$TITLE_ENV" ]; then
  verdict_bypass "$HOOK_ID" "no env keyword in title"
fi

# Check which env-URL signatures are in the body/command
URLS="$(printf '%s' "$COMMAND" | grep -Eo 'https?://[^[:space:]"]+' || true)"
HAS_STAGING_URL=$(printf '%s\n' "$URLS" | grep -cE 'https?://[^[:space:]"/]*(staging|stage|preprod)[^[:space:]"/]*\.' || true)
HAS_PROD_URL=$(printf '%s\n' "$URLS" | grep -vE -- '(staging|stage|preprod)' | grep -cE 'https?://([^[:space:]"/]+\.)?app\.example\.com' || true)

# Cross-env mismatch: title says one env, body has a different env's URL
case "$TITLE_ENV" in
  staging)
    if [ "$HAS_PROD_URL" -gt 0 ] && [ "$HAS_STAGING_URL" = "0" ]; then
      verdict_warn "$HOOK_ID" "Env-Correct URLs (IRON LAW): PR title mentions staging but body has PROD URL (app.example.com). Use the staging URL (e.g. https://staging.app.example.com/...) so reviewers can verify in the right env. Bypass: HOOK_BYPASS_ENV_CORRECT_URLS=1."
    fi
    ;;
  prod)
    if [ "$HAS_STAGING_URL" -gt 0 ] && [ "$HAS_PROD_URL" = "0" ]; then
      verdict_warn "$HOOK_ID" "Env-Correct URLs (IRON LAW): PR title mentions PROD but body has staging URL. Use the PROD URL (e.g. https://app.example.com/...) so reviewers can verify in the right env. Bypass: HOOK_BYPASS_ENV_CORRECT_URLS=1."
    fi
    ;;
esac

verdict_allow "$HOOK_ID" "env URLs match title (title=$TITLE_ENV)"
