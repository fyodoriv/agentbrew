#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sanitize-open-prs.sh --repo OWNER/REPO [--preview|--apply] [options]

Preview or edit open pull request bodies that contain tool-specific agent
attribution lines. Preview mode is the default and never calls gh pr edit.

Options:
  --repo OWNER/REPO          GitHub repository to inspect
  --preview                  Print counts and a sample diff without editing PRs
  --apply                    Update matching PR bodies with gh pr edit
  --confirm-repo OWNER/REPO  Required for --apply; must match --repo exactly
  --confirm-public-write     Required for --apply; acknowledges PR body edits
  --limit N                  Maximum open PRs to inspect (default: 200)
  --sample-limit N           Number of matching PRs to list (default: 5)
  -h, --help                 Show this help

Environment:
  AGENT_ATTRIBUTION_LIB Path to the shared strip-agent-attribution.sh library.
                        Defaults to ~/apps/dotfiles/lib/strip-agent-attribution.sh
EOF
}

repo=""
mode="preview"
confirm_repo=""
confirm_public_write="false"
limit="200"
sample_limit="5"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:?--repo requires OWNER/REPO}"
      shift 2
      ;;
    --preview)
      mode="preview"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --confirm-repo)
      confirm_repo="${2:?--confirm-repo requires OWNER/REPO}"
      shift 2
      ;;
    --confirm-public-write)
      confirm_public_write="true"
      shift
      ;;
    --limit)
      limit="${2:?--limit requires a number}"
      shift 2
      ;;
    --sample-limit)
      sample_limit="${2:?--sample-limit requires a number}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$repo" ]]; then
  echo "ERROR: --repo OWNER/REPO is required" >&2
  usage >&2
  exit 2
fi

if ! [[ "$limit" =~ ^[0-9]+$ && "$sample_limit" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --limit and --sample-limit must be non-negative integers" >&2
  exit 2
fi

attr_lib="${AGENT_ATTRIBUTION_LIB:-$HOME/apps/dotfiles/lib/strip-agent-attribution.sh}"
if [[ ! -f "$attr_lib" ]]; then
  echo "ERROR: shared attribution library not found: $attr_lib" >&2
  echo "Set AGENT_ATTRIBUTION_LIB to the strip-agent-attribution.sh path." >&2
  exit 2
fi

# shellcheck source=/dev/null
. "$attr_lib"

if ! command -v _agent_attr_combined_re >/dev/null 2>&1 ||
  ! command -v _strip_agent_attribution_in_stream >/dev/null 2>&1; then
  echo "ERROR: $attr_lib must define the attribution regex and stream filter" >&2
  exit 2
fi

combined_re="$(_agent_attr_combined_re)"

if [[ "$mode" == "apply" ]]; then
  if [[ "$confirm_repo" != "$repo" || "$confirm_public_write" != "true" ]]; then
    cat >&2 <<EOF
ERROR: --apply edits pull request bodies on $repo.
Re-run with:
  --confirm-repo "$repo" --confirm-public-write
EOF
    exit 2
  fi
elif [[ "$mode" != "preview" ]]; then
  echo "ERROR: unknown mode: $mode" >&2
  exit 2
fi

pr_numbers="$(gh pr list --repo "$repo" --state open --limit "$limit" --json number --jq '.[].number')"

matching_prs=0
matching_lines=0
sample_count=0
sample_list=""
first_pr=""
first_before_file=""
first_after_file=""
updated_prs=0

cleanup() {
  [[ -n "$first_before_file" && -f "$first_before_file" ]] && rm -f "$first_before_file"
  [[ -n "$first_after_file" && -f "$first_after_file" ]] && rm -f "$first_after_file"
}
trap cleanup EXIT

while IFS= read -r number; do
  [[ -z "$number" ]] && continue

  title="$(gh pr view "$number" --repo "$repo" --json title --jq '.title')"
  body="$(gh pr view "$number" --repo "$repo" --json body --jq '.body')"
  matches="$(printf '%s\n' "$body" | grep -inE "$combined_re" || true)"

  if [[ -z "$matches" ]]; then
    continue
  fi

  matching_prs=$((matching_prs + 1))
  line_count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
  matching_lines=$((matching_lines + line_count))

  sanitized="$(printf '%s\n' "$body" | _strip_agent_attribution_in_stream)"

  if [[ "$sample_count" -lt "$sample_limit" ]]; then
    sample_list="${sample_list}- #$number $title"$'\n'
    sample_count=$((sample_count + 1))
  fi

  if [[ -z "$first_pr" ]]; then
    first_pr="$number"
    first_before_file="$(mktemp)"
    first_after_file="$(mktemp)"
    printf '%s\n' "$body" >"$first_before_file"
    printf '%s\n' "$sanitized" >"$first_after_file"
  fi

  if [[ "$mode" == "apply" ]]; then
    body_file="$(mktemp)"
    printf '%s\n' "$sanitized" >"$body_file"
    gh pr edit "$number" --repo "$repo" --body-file "$body_file"
    rm -f "$body_file"
    updated_prs=$((updated_prs + 1))
  fi
done <<<"$pr_numbers"

cat <<EOF
Repository: $repo
Mode: $mode
Shared regex source: $attr_lib
Open PRs inspected: $(printf '%s\n' "$pr_numbers" | grep -c '^[0-9]' || true)
Matching PRs: $matching_prs
Matching lines: $matching_lines
EOF

if [[ -n "$sample_list" ]]; then
  printf '\nSample matching PRs:\n%s' "$sample_list"
fi

if [[ -n "$first_pr" ]]; then
  echo ""
  echo "Sample body diff (#$first_pr):"
  echo "--- before"
  echo "+++ after"
  diff -u "$first_before_file" "$first_after_file" | sed '1,2d' || true
fi

if [[ "$mode" == "apply" ]]; then
  echo ""
  echo "Updated PR bodies: $updated_prs"
elif [[ "$matching_prs" -gt 0 ]]; then
  cat <<EOF

Preview only. To edit matching open PR bodies after explicit approval:
  scripts/sanitize-open-prs.sh --repo "$repo" --apply --confirm-repo "$repo" --confirm-public-write
EOF
fi
