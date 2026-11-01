#!/bin/bash
# Read-only repo watcher for the /work watch phase (#555). Prints the start
# state of each repo, then one line each time the branch head moves or any
# issue or pull request is updated.
#
# Usage: watch-repos.sh <interval-seconds> <owner/repo@branch>...
#
# It reads the latest update times through GraphQL (the REST issues list can
# return [] for a while). A failed read counts as no change, so a network blip
# never prints a false change. It uses your existing `gh` login.
#
# Environment:
#   WATCH_REPOS_MAX_PASSES  stop after this many passes (default: never)
#
# Exit 2 on bad input. Runs under macOS /bin/bash 3.2.

set -uo pipefail

usage() { echo "Usage: watch-repos.sh <interval-seconds> <owner/repo@branch>..." >&2; exit 2; }
[ "$#" -ge 2 ] || usage
interval="$1"; shift
case "$interval" in '' | *[!0-9]*) usage ;; esac
for t in "$@"; do
  case "$t" in */*@?*) ;; *) usage ;; esac
done

# shellcheck disable=SC2016  # GraphQL variables, not shell ones
query='query($o:String!,$n:String!,$b:String!){repository(owner:$o,name:$n){
  ref(qualifiedName:$b){target{oid}}
  issues(first:1,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{updatedAt}}
  pullRequests(first:1,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{updatedAt}}}}'

# Prints "<head-sha> <issues-updated> <prs-updated>", or fails.
read_state() {
  local repo="${1%@*}" branch="${1##*@}" out
  out="$(gh api graphql -f query="$query" -f o="${repo%%/*}" -f n="${repo#*/}" -f b="refs/heads/$branch" \
    --jq '.data.repository | [(.ref.target.oid // "none"), (.issues.nodes[0].updatedAt // "none"), (.pullRequests.nodes[0].updatedAt // "none")] | join(" ")' \
    2>/dev/null)" || return 1
  [ "$(printf '%s' "$out" | wc -w | tr -d ' ')" = 3 ] || return 1
  printf '%s' "$out"
}

states=()
i=0
for t in "$@"; do
  if s="$(read_state "$t")"; then
    read -r head issues prs <<<"$s"
    echo "start $t head=${head:0:7} issues=$issues prs=$prs"
  else
    s=""
    echo "start $t (read failed; waiting for the next pass)"
  fi
  states[i]="$s"
  i=$((i + 1))
done

pass=0
max="${WATCH_REPOS_MAX_PASSES:-0}"
while [ "$max" = 0 ] || [ "$pass" -lt "$max" ]; do
  sleep "$interval"
  pass=$((pass + 1))
  i=0
  for t in "$@"; do
    old="${states[i]}"
    if new="$(read_state "$t")" && [ "$new" != "$old" ]; then
      if [ -n "$old" ]; then
        read -r oh oi op <<<"$old"
        read -r nh ni np <<<"$new"
        [ "$oh" != "$nh" ] && echo "change $t head ${oh:0:7} -> ${nh:0:7}"
        [ "$oi" != "$ni" ] && echo "change $t issue updated $ni"
        [ "$op" != "$np" ] && echo "change $t pr updated $np"
      else
        read -r nh ni np <<<"$new"
        echo "start $t head=${nh:0:7} issues=$ni prs=$np"
      fi
      states[i]="$new"
    fi
    i=$((i + 1))
  done
done
