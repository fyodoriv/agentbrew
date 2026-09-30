#!/bin/bash
# agentbrew/hooks/checks/manual-test-steps-start-at-app-url.sh
#
# **Hook**: manual-test-steps-start-at-app-url
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md:700 "Manual Test Steps Start at the App URL (IRON LAW)"
#
# When a PR body contains a "Manual test steps" / "Test plan" / "How to
# test" section, the FIRST step must begin with an app URL (the user
# opens that URL in a browser). PRs that say "1. clone the branch" or
# "1. yarn install" first force the reviewer to set up a local env
# before they can verify — that's a 10-minute tax per review.
#
# Canonical app URL prefixes (example ecosystem):
#   - https://app.example.com/...
#   - https://*.app.example.com/...
#   - https://staging.app.example.com/...
#   - http://localhost:* (allowed when local-only testing is the ONLY path)
#
# **What gets blocked**:
#   - PR body has "## Manual test steps\n1. yarn install\n2. yarn dev\n3. Open app" — block (step 1 is setup, not URL)
#   - PR body has "## Test plan\n- Pull the branch\n- Run yarn test" — block (no URL anywhere)
#
# **What does NOT get blocked**:
#   - PR body has "## Manual test steps\n1. Open https://staging.app.example.com/" — allow
#   - PR body has no test-plan section at all — allow (separate enforcement)
#   - PR body has localhost URL — allow (clearly local-only context)
#
# **Bypass**: `HOOK_BYPASS_MANUAL_TEST_STEPS_START_AT_APP_URL=1` for the
# legitimate cases where local-env setup IS step 1 (e.g. a new repo
# bootstrap PR).

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="manual-test-steps-start-at-app-url"

if [ "${HOOK_BYPASS_MANUAL_TEST_STEPS_START_AT_APP_URL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_MANUAL_TEST_STEPS_START_AT_APP_URL=1"
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

# Only fire on gh pr create / edit
if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|edit)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

# Inspect the entire COMMAND text (multi-line --body args break naive sed
# extraction). Since the goal is to detect "test plan section without
# URL", checking the full command is equivalent — false positives only
# fire when the agent passes the same text via --body-file or stdin,
# which is rare for gh pr create.

# Does the command have a manual-test-steps section header?
HAS_TEST_SECTION=$(printf '%s' "$COMMAND" | grep -ciE '##[[:space:]]+(Manual test steps|Test plan|How to test|Testing|To verify|Steps to reproduce)' || true)

if [ "$HAS_TEST_SECTION" = "0" ]; then
  verdict_bypass "$HOOK_ID" "no manual-test-steps section detected"
fi

# Does the command contain an app URL anywhere?
HAS_APP_URL=$(printf '%s' "$COMMAND" | grep -ciE 'https?://[^[:space:]"]*(app\.example\.com|localhost|127\.0\.0\.1)' || true)

if [ "$HAS_APP_URL" = "0" ]; then
  verdict_block "$HOOK_ID" "Manual Test Steps Start at the App URL (IRON LAW): PR body has a test-plan section but no app URL.
Reviewers shouldn't have to set up a local env to verify a PR. Start step 1 with an URL like:
  - https://staging.app.example.com/releases
  - https://app.example.com/...
  - http://localhost:3000 (local-only PRs)
Bypass: HOOK_BYPASS_MANUAL_TEST_STEPS_START_AT_APP_URL=1 (only for repo-bootstrap PRs where local setup IS step 1)."
fi

verdict_allow "$HOOK_ID" "manual test steps reference an app URL"
