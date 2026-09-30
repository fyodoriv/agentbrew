#!/usr/bin/env bash

set -euo pipefail

# Runtime-selected sources are annotated at each source call.

usage() {
  cat <<'EOF'
Usage: scripts/sanitize-history.sh [--repo PATH] [--preview|--apply] [options]

Preview or rewrite git commit messages that contain tool-specific agent
attribution lines. Preview mode is the default and never modifies history.

Options:
  --repo PATH           Repository to inspect (default: current directory)
  --preview             Print counts and a sample diff without changing history
  --apply               Rewrite commit messages with git-filter-repo
  --confirm-repo NAME   Required for --apply; must match the repo directory name
  --force               Pass --force to git-filter-repo (for disposable clones)
  --sample-limit N      Number of matching commits to list (default: 5)
  -h, --help            Show this help

Environment:
  AGENT_ATTRIBUTION_LIB Path to the shared strip-agent-attribution.sh library.
                        Defaults to ~/apps/dotfiles/lib/strip-agent-attribution.sh
EOF
}

repo="."
mode="preview"
confirm_repo=""
sample_limit="5"
force_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:?--repo requires a path}"
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
      confirm_repo="${2:?--confirm-repo requires a repository name}"
      shift 2
      ;;
    --force)
      force_args=(--force)
      shift
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

if ! [[ "$sample_limit" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --sample-limit must be a non-negative integer" >&2
  exit 2
fi

repo_path="$(cd "$repo" && pwd)"
repo_name="$(basename "$repo_path")"

if ! git -C "$repo_path" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not a git repository: $repo_path" >&2
  exit 2
fi

attr_lib="${AGENT_ATTRIBUTION_LIB:-$HOME/apps/dotfiles/lib/strip-agent-attribution.sh}"
if [[ ! -f "$attr_lib" ]]; then
  echo "ERROR: shared attribution library not found: $attr_lib" >&2
  echo "Set AGENT_ATTRIBUTION_LIB to the strip-agent-attribution.sh path." >&2
  exit 2
fi

# shellcheck disable=SC1090
. "$attr_lib"

if ! command -v _agent_attr_combined_re >/dev/null 2>&1; then
  echo "ERROR: $attr_lib does not define _agent_attr_combined_re" >&2
  exit 2
fi

combined_re="$(_agent_attr_combined_re)"

python_bin="${PYTHON:-python3}"
if ! command -v "$python_bin" >/dev/null 2>&1; then
  echo "ERROR: python3 is required for scanning commit messages." >&2
  exit 2
fi

scan_metrics_file="$(mktemp)"
cleanup() {
  rm -f "$scan_metrics_file"
}
trap cleanup EXIT

export AGENT_ATTR_COMBINED_RE="$combined_re"
export ATTR_LIB="$attr_lib"
export MODE="$mode"
export REPO_NAME="$repo_name"
export REPO_PATH="$repo_path"
export SAMPLE_LIMIT="$sample_limit"
export SCAN_METRICS_FILE="$scan_metrics_file"

"$python_bin" <<'PY'
import difflib
import os
import re
import subprocess

repo_path = os.environ["REPO_PATH"]
repo_name = os.environ["REPO_NAME"]
attr_lib = os.environ["ATTR_LIB"]
mode = os.environ["MODE"]
sample_limit = int(os.environ["SAMPLE_LIMIT"])
line_pattern = re.compile(
    os.environ["AGENT_ATTR_COMBINED_RE"].replace("[[:space:]]", r"\s"),
    re.IGNORECASE,
)


def matching_message_lines(message):
    return [line for line in message.splitlines() if line_pattern.search(line)]


def strip_matching_lines(message):
    return "".join(line for line in message.splitlines(keepends=True) if not line_pattern.search(line))

raw_log = subprocess.check_output(
    ["git", "-C", repo_path, "log", "--all", "--format=%x1e%H%x1f%s%x1f%B"],
    text=True,
    errors="replace",
)

matching_commits = 0
matching_lines = 0
samples = []
first_match = None

for record in raw_log.split("\x1e"):
    if not record.strip():
        continue

    try:
        commit, subject, message = record.split("\x1f", 2)
    except ValueError:
        continue

    matches = matching_message_lines(message)
    if not matches:
        continue

    matching_commits += 1
    matching_lines += len(matches)

    if len(samples) < sample_limit:
        samples.append((commit[:12], subject.strip()))

    if first_match is None:
        first_match = (commit[:12], message, strip_matching_lines(message))

with open(os.environ["SCAN_METRICS_FILE"], "w", encoding="utf-8") as metrics:
    metrics.write(f"matching_commits={matching_commits}\n")
    metrics.write(f"matching_lines={matching_lines}\n")

print(f"Repository: {repo_path}")
print(f"Mode: {mode}")
print(f"Shared regex source: {attr_lib}")
print(f"Matching commits: {matching_commits}")
print(f"Matching lines: {matching_lines}")

if samples:
    print("\nSample matching commits:")
    for commit, subject in samples:
        print(f"- {commit} {subject}")

if first_match is not None:
    commit, before, after = first_match
    print(f"\nSample message diff ({commit}):")
    for line in difflib.unified_diff(
        before.splitlines(),
        after.splitlines(),
        fromfile="before",
        tofile="after",
        lineterm="",
    ):
        print(line)

if mode == "preview" and matching_commits > 0:
    print(
        "\nPreview only. To rewrite this disposable or freshly cloned repo:\n"
        f"  scripts/sanitize-history.sh --repo \"{repo_path}\" --apply --confirm-repo \"{repo_name}\"\n\n"
        "Do not force-push rewritten history without explicit per-repo approval."
    )
PY

matching_commits=0
# shellcheck disable=SC1090
. "$scan_metrics_file"

if [[ "$mode" == "preview" ]]; then
  exit 0
fi

if [[ "$mode" != "apply" ]]; then
  echo "ERROR: unknown mode: $mode" >&2
  exit 2
fi

if [[ "$matching_commits" -eq 0 ]]; then
  echo "No matching commit messages found; nothing to rewrite."
  exit 0
fi

if [[ "$confirm_repo" != "$repo_name" ]]; then
  cat >&2 <<EOF
ERROR: --apply rewrites every matching commit SHA in $repo_path.
Re-run with --confirm-repo "$repo_name" after reading scripts/README.md.
EOF
  exit 2
fi

if [[ -n "$(git -C "$repo_path" status --porcelain)" ]]; then
  echo "ERROR: refusing to rewrite history with a dirty working tree." >&2
  echo "Commit, discard, or clone a fresh copy before running --apply." >&2
  exit 2
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "ERROR: git-filter-repo is required for --apply." >&2
  echo "Install it first, then re-run the script." >&2
  exit 2
fi

export AGENT_ATTR_COMBINED_RE="$combined_re"

callback="$(cat <<'PY'
import os
import re

line_pattern = re.compile(
    os.environ["AGENT_ATTR_COMBINED_RE"].replace("[[:space:]]", r"\s").encode(),
    re.IGNORECASE,
)
return b"".join(line for line in message.splitlines(keepends=True) if not line_pattern.search(line))
PY
)"

git -C "$repo_path" filter-repo "${force_args[@]}" --message-callback "$callback"

cat <<EOF
History rewrite complete for $repo_path.

Next steps:
  1. Re-run this script in --preview mode; it should report 0 matches.
  2. Inspect rewritten history and run the repo's verification suite.
  3. If this is a shared remote, get explicit approval before any force-push.
EOF
