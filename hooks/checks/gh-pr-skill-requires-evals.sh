#!/bin/bash

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
source "$__HOOK_LIB_DIR/stdin-json.sh"
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="gh-pr-skill-requires-evals"

if [ "${HOOK_BYPASS_GH_PR_SKILL_REQUIRES_EVALS:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_GH_PR_SKILL_REQUIRES_EVALS=1"
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

skill_dir_for_path() {
  local path="$1"
  case "$path" in
    .agents/skills/*/SKILL.md | .claude/skills/*/SKILL.md | .config/devin/skills/*/SKILL.md | .cursor/skills/*/SKILL.md | skill-plugins/dev/*/SKILL.md | skills/*/SKILL.md)
      printf '%s\n' "${path%/SKILL.md}"
      ;;
  esac
}

is_valid_evals_file() {
  local path="$1"
  [ -f "$REPO_DIR/$path" ] || return 1
  jq -e '
    def countChecks($name):
      (if (.[$name]? | type == "array") then [.[$name][]? | select(type == "string" and (gsub("^\\s+|\\s+$"; "") | length > 0))] | length else 0 end);
    (.evals | type == "array" and length >= 3) and
    all(.evals[];
      (.prompt | type == "string" and (gsub("^\\s+|\\s+$"; "") | length > 0)) and
      ((countChecks("expectations") >= 3) or (countChecks("assertions") >= 3))
    )
  ' "$REPO_DIR/$path" >/dev/null
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

has_skill_eval_sections() {
  local body="$1"
  printf '%s' "$body" | grep -qiE '^##[[:space:]]+Skill eval results[[:space:]]*$' &&
    printf '%s' "$body" | grep -qiE '^##[[:space:]]+How to run these tests yourself[[:space:]]*$'
}

path_changed_in_diff() {
  local path="$1"
  printf '%s\n' "$DIFF_NAME_STATUS" | awk -F '\t' '{print $NF}' | grep -Fxq "$path"
}

BASE_REF="$(resolve_base_ref || true)"
if [ -z "$BASE_REF" ]; then
  verdict_bypass "$HOOK_ID" "could not resolve git base ref"
fi

DIFF_NAME_STATUS="$(git -C "$REPO_DIR" diff --name-status "$BASE_REF"...HEAD -- 2>/dev/null || true)"
if [ -z "$DIFF_NAME_STATUS" ]; then
  verdict_bypass "$HOOK_ID" "no diff against $BASE_REF"
fi

ADDED_SKILL_DIRS=""
MODIFIED_SKILL_DIRS=""
while IFS= read -r line; do
  status="${line%%$'\t'*}"
  path="${line#*$'\t'}"
  path="${path##*$'\t'}"
  skill_dir="$(skill_dir_for_path "$path")"
  if [ -z "$skill_dir" ]; then
    continue
  fi
  case "$status" in
    A*) ADDED_SKILL_DIRS="${ADDED_SKILL_DIRS}${skill_dir}"$'\n' ;;
    M*) MODIFIED_SKILL_DIRS="${MODIFIED_SKILL_DIRS}${skill_dir}"$'\n' ;;
  esac
done <<<"$DIFF_NAME_STATUS"

ADDED_SKILL_DIRS="$(printf '%s' "$ADDED_SKILL_DIRS" | sed '/^$/d' | sort -u)"
MODIFIED_SKILL_DIRS="$(printf '%s' "$MODIFIED_SKILL_DIRS" | sed '/^$/d' | sort -u)"

if [ -z "$ADDED_SKILL_DIRS" ] && [ -z "$MODIFIED_SKILL_DIRS" ]; then
  verdict_bypass "$HOOK_ID" "no skill SKILL.md changes"
fi

BODY_TEXT="$(pr_body_text)"

if [ -n "$ADDED_SKILL_DIRS" ] && ! has_skill_eval_sections "$BODY_TEXT"; then
  verdict_block "$HOOK_ID" "Skill PRs Must Ship Evals (IRON LAW): add both PR sections '## Skill eval results' and '## How to run these tests yourself'. Use the skill-author skill to generate and run evals."
fi

while IFS= read -r skill_dir; do
  [ -n "$skill_dir" ] || continue
  evals_path="$skill_dir/evals/evals.json"
  if ! path_changed_in_diff "$evals_path"; then
    verdict_block "$HOOK_ID" "Skill PRs Must Ship Evals (IRON LAW): new skill '$skill_dir' must add '$evals_path' in the same PR. Use the skill-author skill, then include '## Skill eval results' and '## How to run these tests yourself' in the PR body."
  fi
  if ! is_valid_evals_file "$evals_path"; then
    verdict_block "$HOOK_ID" "Skill PRs Must Ship Evals (IRON LAW): '$evals_path' must contain ≥3 evals; each needs a non-empty prompt plus ≥3 non-empty expectations or assertions."
  fi
done <<<"$ADDED_SKILL_DIRS"

if [ -n "$MODIFIED_SKILL_DIRS" ]; then
  while IFS= read -r skill_dir; do
    [ -n "$skill_dir" ] || continue
    evals_path="$skill_dir/evals/evals.json"
    if ! path_changed_in_diff "$evals_path"; then
      verdict_warn "$HOOK_ID" "Existing skill changed without adding a new evals/evals.json file. Consider updating evals and documenting results with skill-author."
    fi
  done <<<"$MODIFIED_SKILL_DIRS"
fi

verdict_allow "$HOOK_ID" "skill eval gate passed"
