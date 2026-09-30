#!/bin/bash
# agentbrew/hooks/checks/gh-pr-agent-artifacts-require-tests.sh
#
# Blocks `gh pr create` / `gh pr edit` when high-impact agent artifacts changed
# without same-PR tests, evals, or `Agent artifact test exemption: <reason>`.
# Bypass: `HOOK_BYPASS_GH_PR_AGENT_ARTIFACTS_REQUIRE_TESTS=1`, then file a P0
# follow-up task for the untested artifact change.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-agent-artifacts-require-tests"
readonly BYPASS_ENV_VAR="HOOK_BYPASS_GH_PR_AGENT_ARTIFACTS_REQUIRE_TESTS"

if [ "${HOOK_BYPASS_GH_PR_AGENT_ARTIFACTS_REQUIRE_TESTS:-0}" = "1" ]; then
  verdict_warn "$HOOK_ID" "$BYPASS_ENV_VAR=1: bypassing agent artifact evidence gate. File a P0 follow-up task that records which agent artifact paths shipped without same-PR tests or evals."
fi

INPUT="$(read_hook_stdin)"
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command"
fi

if ! printf '%s' "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|edit)\b'; then
  verdict_bypass "$HOOK_ID" "not gh pr create/edit"
fi

REPO_DIR="$(json_get "$INPUT" '.cwd')"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(pwd -P)"
fi

resolve_base_ref() {
  if git -C "$REPO_DIR" rev-parse --verify -q origin/HEAD >/dev/null; then
    printf '%s' "origin/HEAD"
  elif git -C "$REPO_DIR" rev-parse --verify -q main >/dev/null; then
    printf '%s' "main"
  elif git -C "$REPO_DIR" rev-parse --verify -q HEAD~1 >/dev/null; then
    printf '%s' "HEAD~1"
  else
    return 1
  fi
}

pr_body_text() {
  local file
  file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)\"([^\"]*)\".*/\2/p" | head -1)"
  if [ -z "$file" ]; then
    file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)'([^']*)'.*/\2/p" | head -1)"
  fi
  if [ -z "$file" ]; then
    file="$(printf '%s' "$COMMAND" | sed -nE "s/.*--body-file(=|[[:space:]]+)([^[:space:]]+).*/\2/p" | head -1)"
  fi
  if [ -n "$file" ] && [ "$file" != "-" ]; then
    if [ "${file#/}" = "$file" ]; then
      file="$REPO_DIR/$file"
    fi
    if [ -f "$file" ]; then
      cat "$file"
      return 0
    fi
  fi
  printf '%s' "$COMMAND"
}

inventory_high_risk_paths() {
  local tsx_bin="$REPO_DIR/node_modules/.bin/tsx"
  if [ ! -x "$tsx_bin" ] || [ ! -f "$REPO_DIR/src/agent-artifacts/inventory.ts" ]; then
    return 0
  fi
  (
    cd "$REPO_DIR"
    "$tsx_bin" --eval '
    import { collectAgentArtifacts } from "./src/agent-artifacts/inventory.ts";
    const paths = new Set();
    for (const artifact of collectAgentArtifacts().artifacts) {
      if (artifact.risk === "high") paths.add(artifact.sourcePath);
    }
    console.log([...paths].sort().join("\n"));
  '
  ) 2>/dev/null || true
}

path_in_lines() {
  local needle="$1"
  local haystack="$2"
  printf '%s\n' "$haystack" | grep -Fxq "$needle"
}

is_agent_artifact_path() {
  local path="$1"
  if path_in_lines "$path" "$INVENTORY_HIGH_RISK_PATHS"; then
    return 0
  fi
  case "$path" in
    Agentfile.yaml|catalog.yaml|catalog-overlay.yaml|src/catalog.yaml|src/core/agents.yaml|shared-rules.md|templates/AGENTS.md)
      return 0
      ;;
    commands/*.md|src/cli-commands/*.md|.cursor/rules/*.mdc)
      return 0
      ;;
    hooks/manifest.yaml|hooks/verifiers/*)
      return 0
      ;;
    hooks/checks/*.sh)
      case "$path" in
        *.test.sh) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
}

is_test_evidence_path() {
  local path="$1"
  case "$path" in
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx|hooks/checks/*.test.sh|tests/*|test/*|real-e2e/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_eval_evidence_path() {
  local path="$1"
  case "$path" in
    evals/evals.json|*/evals/evals.json|agent-artifact-evals/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

exemption_reason() {
  local body="$1"
  printf '%s' "$body" | sed -nE 's/.*(Agent artifact test exemption|agentbrew-artifact-exemption):[[:space:]]*(.+)$/\2/Ip' | head -1
}

BASE_REF="$(resolve_base_ref || true)"
if [ -z "$BASE_REF" ]; then
  verdict_bypass "$HOOK_ID" "could not resolve git base ref"
fi

DIFF_NAME_STATUS="$(git -C "$REPO_DIR" diff --name-status "$BASE_REF"...HEAD -- 2>/dev/null || true)"
if [ -z "$DIFF_NAME_STATUS" ]; then
  verdict_bypass "$HOOK_ID" "no diff against $BASE_REF"
fi

INVENTORY_HIGH_RISK_PATHS="$(inventory_high_risk_paths)"
CHANGED_PATHS="$(printf '%s\n' "$DIFF_NAME_STATUS" | awk -F '\t' '{print $NF}' | sed '/^$/d' | sort -u)"
CHANGED_ARTIFACTS=""
HAS_EVIDENCE=0

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if is_test_evidence_path "$path" || is_eval_evidence_path "$path"; then
    HAS_EVIDENCE=1
  fi
  if is_agent_artifact_path "$path"; then
    CHANGED_ARTIFACTS="${CHANGED_ARTIFACTS}${path}"$'\n'
  fi
done <<<"$CHANGED_PATHS"

CHANGED_ARTIFACTS="$(printf '%s' "$CHANGED_ARTIFACTS" | sed '/^$/d' | sort -u)"
if [ -z "$CHANGED_ARTIFACTS" ]; then
  verdict_bypass "$HOOK_ID" "no changed high-impact agent artifacts"
fi

if [ "$HAS_EVIDENCE" = "1" ]; then
  verdict_allow "$HOOK_ID" "agent artifact changes include test or eval evidence"
fi

BODY_TEXT="$(pr_body_text)"
EXEMPTION_REASON="$(exemption_reason "$BODY_TEXT")"
if [ -n "$EXEMPTION_REASON" ]; then
  verdict_warn "$HOOK_ID" "Agent artifact test exemption accepted: $EXEMPTION_REASON"
fi

ARTIFACT_LIST="$(printf '%s' "$CHANGED_ARTIFACTS" | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
verdict_block "$HOOK_ID" "Agent artifact PR changes need same-PR tests, evals, or an exemption reason; changed artifacts: $ARTIFACT_LIST; add a deterministic test (*.test.*, hooks/checks/*.test.sh), a behavioral eval (agent-artifact-evals/** or evals/evals.json), or include 'Agent artifact test exemption: <reason>' in the PR body. Emergency bypass: $BYPASS_ENV_VAR=1, then file a P0 follow-up task."
