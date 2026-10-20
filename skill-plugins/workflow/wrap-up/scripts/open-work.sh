#!/bin/bash
# List the open work in each git checkout, one line per item. Read-only except
# for `git fetch`. The wrap-up skill, the repo checkups, and the pre-task check
# in the deployed agent instructions all call it.
#
# Usage: open-work.sh [REPO ...]     (default: the current repo)
#
# Environment:
#   OPEN_WORK_NO_FETCH=1   skip `git fetch`
#   OPEN_WORK_NO_GH=1      skip pull request lookups
#
# Kinds:
#   dirty      uncommitted or untracked files
#   stash      stashed changes
#   unpushed   commits on the current branch that no remote has
#   branch     a local branch with commits not on the default branch
#   pr         an open pull request by you (draft, checks, merge state)
#   unknown    the script could not check; check by hand
#
# Exit 0 when nothing is open, 1 when something is, 2 on bad input.
# Runs under macOS /bin/bash 3.2.

set -uo pipefail

NO_FETCH="${OPEN_WORK_NO_FETCH:-0}"
NO_GH="${OPEN_WORK_NO_GH:-0}"
open=0

say() {
  printf '  %-9s %s\n' "$1" "$2"
  open=1
}

default_branch() {
  local ref
  ref="$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" && {
    echo "${ref#origin/}"
    return
  }
  for b in main master; do
    git -C "$1" rev-parse -q --verify "refs/remotes/origin/$b" >/dev/null && {
      echo "$b"
      return
    }
  done
  git -C "$1" branch --show-current
}

check_repo() {
  local repo="$1" top base current n
  if ! top="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)"; then
    echo "open-work: not a git checkout: $repo" >&2
    return 2
  fi
  echo "$top"
  [ "$NO_FETCH" = 1 ] || git -C "$top" fetch -q --prune origin 2>/dev/null || say unknown "git fetch failed; results may be stale"
  base="$(default_branch "$top")"
  current="$(git -C "$top" branch --show-current)"

  n="$(git -C "$top" status --porcelain | grep -c .)"
  [ "$n" -gt 0 ] && say dirty "$n uncommitted or untracked file(s) on ${current:-detached HEAD}"
  n="$(git -C "$top" stash list | grep -c .)"
  [ "$n" -gt 0 ] && say stash "$n stash(es)"

  if [ -n "$current" ]; then
    if git -C "$top" rev-parse -q --verify "refs/remotes/origin/$current" >/dev/null; then
      n="$(git -C "$top" rev-list --count "origin/$current..$current")"
    else
      n="$(git -C "$top" rev-list --count "$current" --not --remotes)"
    fi
    [ "$n" -gt 0 ] && say unpushed "$n commit(s) on $current"
  fi

  local b ahead merged
  while IFS= read -r b; do
    [ -n "$b" ] && [ "$b" != "$base" ] || continue
    ahead="$(git -C "$top" rev-list --count "origin/$base..$b" 2>/dev/null || echo 0)"
    [ "$ahead" -gt 0 ] || continue
    # A squash-merged branch keeps its commits: skip it when merging it would
    # leave the base unchanged (needs git 2.38+; older git reports it).
    if merged="$(git -C "$top" merge-tree --write-tree "origin/$base" "$b" 2>/dev/null)" &&
      [ "$merged" = "$(git -C "$top" rev-parse "origin/$base^{tree}")" ]; then
      continue
    fi
    say branch "$b: $ahead commit(s) not on $base"
  done <<<"$(git -C "$top" for-each-ref --format='%(refname:short)' refs/heads)"

  [ "$NO_GH" = 1 ] && return 0
  if ! command -v gh >/dev/null 2>&1; then
    say unknown "gh is not installed; pull requests not checked"
    return 0
  fi
  local prs
  if prs="$(cd "$top" && gh pr list --author @me --state open --limit 50 \
    --json number,title,headRefName,isDraft,mergeable,statusCheckRollup \
    --jq '.[] | [.number, (if .isDraft then "draft" else "ready" end), .headRefName, .mergeable,
      ([.statusCheckRollup[]? | (.conclusion // .state // "")] | if any(. == "FAILURE" or . == "ERROR") then "red"
        elif any(. == "" or . == "PENDING" or . == "IN_PROGRESS" or . == "QUEUED") then "pending"
        elif length == 0 then "no-checks" else "green" end), .title] | @tsv' 2>/dev/null)"; then
    local number state head mergeable checks title
    while IFS=$'\t' read -r number state head mergeable checks title; do
      [ -n "$number" ] || continue
      say pr "#$number $state, checks $checks, $(echo "$mergeable" | tr "[:upper:]" "[:lower:]") $head: $title"
    done <<<"$prs"
  else
    say unknown "gh pr list failed (no GitHub remote, or not signed in)"
  fi
}

[ "$#" -gt 0 ] || set -- .
rc=0
for repo in "$@"; do
  check_repo "$repo" || rc=2
done
[ "$rc" = 2 ] && exit 2
[ "$open" = 1 ] && exit 1
echo "  none"
exit 0
