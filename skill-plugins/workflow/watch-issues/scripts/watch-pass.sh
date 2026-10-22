#!/usr/bin/env bash
# One watch pass: list what needs work in each repo, and mark what is new since the last pass.
# Usage: watch-pass.sh [--record] [--state-dir DIR] [REPO_DIR...]
#   With no REPO_DIR, it reads one path per line from ~/.config/watch-issues/repos,
#   else it watches the current git repo.
# It prints one line per item:
#   new|open  issue  <owner/name>#<n>  by <login>: <title>
#   new|open  task   <repo>/<task-id>: <title>
#   new|open  pr     <owner/name>#<n>  <conflicting|red|draft>: <title>
# then "watch: N new, M open". It changes nothing except, with --record, its seen list.
# Exit 0 always; a repo that cannot be read prints a "skip" line with the reason.
set -uo pipefail

record=0
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/watch-issues"
repos=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --record) record=1; shift ;;
    --state-dir) state_dir="${2:?--state-dir needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) repos+=("$1"); shift ;;
  esac
done

if [ "${#repos[@]}" -eq 0 ]; then
  config="${WATCH_ISSUES_REPOS_FILE:-$HOME/.config/watch-issues/repos}"
  if [ -f "$config" ]; then
    while IFS= read -r line; do
      line="${line%%#*}"; line="$(printf '%s' "$line" | sed 's/[[:space:]]*$//')"
      [ -n "$line" ] && repos+=("${line/#\~/$HOME}")
    done <"$config"
  else
    repos+=("$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
  fi
fi

mkdir -p "$state_dir"
seen="$state_dir/seen"
touch "$seen"
current="$(mktemp "${TMPDIR:-/tmp}/watch-pass.XXXXXX")"
trap 'rm -f "$current"' EXIT

new_count=0 open_count=0
emit() { # emit <kind> <key> <text>
  printf '%s %s\n' "$1" "$2" >>"$current"
  if grep -qxF "$1 $2" "$seen"; then
    printf 'open  %-5s %s\n' "$1" "$3"; open_count=$((open_count + 1))
  else
    printf 'new   %-5s %s\n' "$1" "$3"; new_count=$((new_count + 1))
  fi
}

# Unblocked task blocks in a TASKS.md text: "<id>\t<title>" for each "- [ ]" block with an ID and no Blocked line.
unblocked_tasks() {
  awk '
    function flush() { if (id != "" && !blocked) printf "%s\t%s\n", id, title; id=""; blocked=0 }
    /^- \[ \] / { flush(); title=substr($0, 7); next }
    /^  - \*\*ID\*\*:/ { id=$3; next }
    /^  - \*\*Blocked\*\*:/ { blocked=1; next }
    /^## / { flush() }
    END { flush() }'
}

for repo in "${repos[@]}"; do
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "skip  $repo: not a git checkout"; continue
  fi
  name="$(basename "$repo")"
  slug="$(git -C "$repo" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]+([^/]+/[^/.]+)(\.git)?/?$#\1#p')"
  def="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  git -C "$repo" fetch --quiet origin "${def:-HEAD}" 2>/dev/null || echo "skip  $name: git fetch failed (showing the last fetched queue)"

  if [ -n "$def" ] && tasks="$(git -C "$repo" show "origin/$def:TASKS.md" 2>/dev/null)"; then
    while IFS="$(printf '\t')" read -r id title; do
      [ -n "$id" ] && emit task "$name/$id" "$name/$id: $title"
    done < <(printf '%s\n' "$tasks" | unblocked_tasks)
  fi

  [ -n "$slug" ] || { echo "skip  $name: origin is not a GitHub repo (issues and PRs not checked)"; continue; }
  if issues="$(gh issue list -R "$slug" --state open --limit 50 --json number,title,author \
      --jq '.[] | "\(.number)\t\(.author.login)\t\(.title)"' 2>/dev/null)"; then
    while IFS="$(printf '\t')" read -r num who title; do
      [ -n "$num" ] && emit issue "$slug#$num" "$slug#$num by $who: $title"
    done <<<"$issues"
  else
    echo "skip  $name: gh issue list failed (signed in? gh auth status)"
  fi
  if prs="$(gh pr list -R "$slug" --author @me --state open --limit 50 \
      --json number,title,isDraft,mergeable,statusCheckRollup \
      --jq '.[] | [.number, .title, (if .mergeable == "CONFLICTING" then "conflicting"
          elif ([.statusCheckRollup[]? | (.conclusion // .state)] | any(. == "FAILURE" or . == "ERROR")) then "red"
          elif .isDraft then "draft" else "" end)] | @tsv' 2>/dev/null)"; then
    while IFS="$(printf '\t')" read -r num title why; do
      [ -n "$num" ] && [ -n "$why" ] && emit pr "$slug#$num" "$slug#$num $why: $title"
    done <<<"$prs"
  fi
done

echo "watch: $new_count new, $open_count open"
[ "$record" -eq 1 ] && sort -u "$current" >"$seen"
exit 0
