#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  "") apply=false ;;
  --yes) apply=true ;;
  -h|--help) printf 'Usage: prune-merged-worktrees.sh [--yes]\n'; exit 0 ;;
  *) printf 'Usage: prune-merged-worktrees.sh [--yes]\n' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || exit 2

current=$(git rev-parse --show-toplevel)
base=$(git rev-parse --verify refs/remotes/origin/main 2>/dev/null || true)
remote=$(git ls-remote --exit-code origin refs/heads/main 2>/dev/null | awk '{ print $1 }') || remote=""
inventory=$(mktemp)
trap 'rm -f "$inventory"' EXIT
git worktree list --porcelain -z > "$inventory"

merge_records=""
origin_url=$(git remote get-url origin 2>/dev/null || true)
case "$origin_url" in
  https://github.com/*) github_repo=${origin_url#https://github.com/} ;;
  git@github.com:*) github_repo=${origin_url#git@github.com:} ;;
  ssh://git@github.com/*) github_repo=${origin_url#ssh://git@github.com/} ;;
  *) github_repo="" ;;
esac
github_repo=${github_repo%.git}
if [ -n "$base" ] && [ "$base" = "$remote" ] && [[ "$github_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && command -v gh >/dev/null; then
  merge_records=$(
    gh pr list --repo "github.com/$github_repo" --state merged --base main --limit 500 --json headRefOid,mergeCommit \
      --jq '.[] | select(.mergeCommit.oid != null) | [.headRefOid,.mergeCommit.oid] | @tsv' 2>/dev/null
  ) || merge_records=""
fi

emit() { printf '%s\t%q\t%s\n' "$1" "$path" "$2"; }

merged() {
  git merge-base --is-ancestor "$head" "$base" && return 0
  local pr_head pr_merge
  while IFS=$'\t' read -r pr_head pr_merge; do
    if [ "$pr_head" = "$head" ] && [ -n "$pr_merge" ] && git merge-base --is-ancestor "$pr_merge" "$base" 2>/dev/null; then
      return 0
    fi
  done <<< "$merge_records"
  return 1
}

consider() {
  if [ "$primary" = true ] || [ "$path" = "$current" ]; then
    emit kept "current or primary checkout"
  elif [ "$locked" = true ]; then
    emit kept "locked worktree"
  elif [ -z "$branch" ] || [ ! -d "$path" ]; then
    emit kept "detached or unavailable checkout"
  elif [[ "$path" == */.codex/worktrees/* ]]; then
    emit kept "archive this worktree from Codex"
  elif [ -z "$base" ] || [ "$base" != "$remote" ]; then
    emit kept "origin/main could not be verified against the remote"
  elif ! merged; then
    emit kept "current commit has no verified merge into origin/main"
  else
    local entries changes
    if ! entries=$(git -C "$path" ls-files -v) || grep -qE '^[a-zS] ' <<< "$entries"; then
      emit kept "worktree index has hidden or unavailable entries"
      return
    fi
    if ! changes=$(git --no-optional-locks -C "$path" status --porcelain=v1 --untracked-files=normal --ignored=matching); then
      emit kept "worktree status is unavailable"
      return
    fi
    if [ -n "$changes" ]; then
      emit kept "uncommitted or unclassified ignored files"
      return
    fi
    if ! $apply; then
      emit eligible "clean worktree with a verified merge"
    elif [ "$(git -C "$path" rev-parse HEAD 2>/dev/null || true)" != "$head" ]; then
      emit kept "worktree commit changed during the check"
    elif git worktree remove "$path" >/dev/null 2>&1; then
      emit removed "clean worktree with a verified merge"
    else
      emit kept "Git refused worktree removal"
    fi
  fi
}

primary=true
path="" head="" branch="" locked=false
while IFS= read -r -d '' field; do
  case "$field" in
    "worktree "*) path=${field#worktree } ;;
    "HEAD "*) head=${field#HEAD } ;;
    "branch "*) branch=${field#branch } ;;
    locked|locked\ *) locked=true ;;
    "")
      [ -n "$path" ] || continue
      consider
      primary=false
      path="" head="" branch="" locked=false
      ;;
  esac
done < "$inventory"
