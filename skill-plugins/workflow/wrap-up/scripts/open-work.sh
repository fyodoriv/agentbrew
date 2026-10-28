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
#   OPEN_WORK_IGNORE_AUTHORS  extended regex of comment authors to skip
#                          (default: ^(github-actions|dependabot)(\[bot\])?$)
#   OPEN_WORK_IGNORE_BODIES   extended regex of comment bodies to skip
#                          (default: none)
#
# Kinds:
#   dirty      uncommitted or untracked files
#   do-not-stage  an uncommitted path that must never be committed: secrets,
#              keys, databases, or private/ data
#   worktree   an extra worktree with commits or uncommitted files
#   stash      stashed changes
#   unpushed   commits on the current branch that no remote has
#   branch     a local branch with commits not on the default branch
#   pr         an open pull request by you (draft, checks, merge state)
#   reply      a comment or review body by someone else on your open pull
#              request, posted after your last reply (author and link only)
#   unknown    the script could not check; check by hand
#
# It prints paths, branch names and counts only, never file contents.
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

# Paths that must never be committed (repo-relative).
risky() {
  case "$1" in
    .env.example | .env.sample | .env.template | */.env.example | */.env.sample | */.env.template) return 1 ;;
    .env | .env.* | */.env | */.env.*) return 0 ;;
    *.pem | *.key | *.p12 | *.pfx | *.kdbx | *id_rsa* | *id_ed25519*) return 0 ;;
    *.sqlite | *.sqlite3 | *.sqlite-wal | *.sqlite-shm | *.db) return 0 ;;
    *credentials* | *secret* | *.token) return 0 ;;
    private/* | */private/*) return 0 ;;
  esac
  return 1
}

# The risky paths among a checkout's uncommitted and untracked files.
risky_changes() {
  local line path
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    path="${line:3}"
    path="${path#\"}"
    path="${path%\"}"
    if risky "$path"; then say do-not-stage "$path${2:+ (in $2)}"; fi
  done <<<"$(git -C "$1" status --porcelain --untracked-files=all 2>/dev/null)"
}

default_branch() {
  local ref
  ref="$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" && {
    echo "${ref#origin/}"
    return
  }
  # No local origin/HEAD (common in fresh clones): ask the remote.
  if [ "$NO_FETCH" != 1 ] && ref="$(git -C "$1" ls-remote --symref origin HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$#\1#p')" && [ -n "$ref" ]; then
    echo "$ref"
    return
  fi
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
  risky_changes "$top"
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

  local b ahead merged fork pid back base_pids merged_heads=""
  # Patch ids of the base's recent commits: a squash merge is one of them.
  base_pids="$(git -C "$top" log -p --no-merges --format='commit %H' -n 1000 "origin/$base" 2>/dev/null | git -C "$top" patch-id --stable | cut -d' ' -f1)"
  # Head commits of PRs merged into the base: a squash that carried a conflict fix matches no patch id.
  if [ "$NO_GH" != 1 ] && command -v gh >/dev/null 2>&1; then
    merged_heads="$(cd "$top" && gh pr list --state merged --base "$base" --limit 500 --json headRefOid --jq '.[].headRefOid' 2>/dev/null)"
  fi
  # shipped <branch>: true when the base already has the branch's change.
  # A squash-merged branch keeps its commits: it is shipped when its tip is a
  # merged PR's head, when its whole diff is one commit on the base that no
  # later commit reverts (still true after the base changes the same lines), or
  # when merging it would leave the base unchanged (needs git 2.38+).
  shipped() {
    local b="$1"
    if [ -n "$merged_heads" ] && grep -qx "$(git -C "$top" rev-parse "$b")" <<<"$merged_heads"; then
      return 0
    fi
    fork="$(git -C "$top" merge-base "origin/$base" "$b" 2>/dev/null)" || fork=""
    pid=""
    back=""
    if [ -n "$fork" ]; then
      pid="$(git -C "$top" diff "$fork" "$b" | git -C "$top" patch-id --stable | cut -d' ' -f1)"
      back="$(git -C "$top" diff "$b" "$fork" | git -C "$top" patch-id --stable | cut -d' ' -f1)"
    fi
    # More copies of the change than reverts of it: a revert of a revert counts as re-applied.
    if [ -n "$pid" ] && [ "$(grep -cx "$pid" <<<"$base_pids")" -gt "$(grep -cx "$back" <<<"$base_pids")" ]; then
      return 0
    fi
    merged="$(git -C "$top" merge-tree --write-tree "origin/$base" "$b" 2>/dev/null)" &&
      [ "$merged" = "$(git -C "$top" rev-parse "origin/$base^{tree}")" ]
  }
  # landed_pct <branch>: the share of the branch's added non-blank lines that
  # the base gained in the same files since the fork. A branch whose change reached the
  # base through other PRs matches no patch id; a high share says "look, then
  # delete it", not "continue it".
  landed_pct() {
    local fork
    fork="$(git -C "$top" merge-base "origin/$base" "$1" 2>/dev/null)" || return 1
    git -C "$top" diff --no-color -U0 "$fork" "$1" 2>/dev/null | awk -v top="$top" -v fork="$fork" -v base="origin/$base" '
      # q: one shell word in single quotes, so a file name never runs as code.
      function q(s,   out, i, c) {
        out = "\047"
        for (i = 1; i <= length(s); i++) { c = substr(s, i, 1); out = out (c == "\047" ? "\047\\\047\047" : c) }
        return out "\047"
      }
      function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
      function count(rev, f, into,   cmd, l) {
        cmd = (top == "" ? "git" : "git -C " q(top)) " show " q(rev ":" f) " 2>/dev/null"
        while ((cmd | getline l) > 0) { l = trim(l); if (l != "") into[f, l]++ }
        close(cmd)
      }
      /^\+\+\+ / { file = ($0 == "+++ /dev/null") ? "" : substr($0, 7); next }
      /^\+/ && file != "" { line = trim(substr($0, 2)); if (line != "") { n++; want[file, line]++; files[file] = 1 } }
      END {
        if (n == 0) exit
        # Only lines the base gained since the fork count, each once: a move or a reindent gained nothing.
        for (f in files) { count(fork, f, before); count(base, f, after) }
        for (k in want) { g = after[k] - before[k]; if (g > 0) hit += (want[k] < g ? want[k] : g) }
        printf "%d\n", (100 * hit) / n
      }
    '
  }
  local pct landed_min="${OPEN_WORK_LANDED_PCT:-90}"
  while IFS= read -r b; do
    [ -n "$b" ] && [ "$b" != "$base" ] || continue
    # Data and bot branches are not work: the git-native task log, Pages, dependency bots.
    case "$b" in tasks-claims | gh-pages | dependabot/* | renovate/*) continue ;; esac
    ahead="$(git -C "$top" rev-list --count "origin/$base..$b" 2>/dev/null || echo 0)"
    [ "$ahead" -gt 0 ] || continue
    shipped "$b" && continue
    pct=""
    # Commits not yet on the branch's own upstream are new work: never call them landed.
    if ! git -C "$top" rev-parse -q --verify "refs/remotes/origin/$b" >/dev/null ||
      [ "$(git -C "$top" rev-list --count "origin/$b..$b")" -eq 0 ]; then
      pct="$(landed_pct "$b")"
    fi
    if [ -n "$pct" ] && [ "$pct" -ge "$landed_min" ]; then
      say branch "$b: $ahead commit(s) not on $base, likely landed ($pct% of its added lines are on $base): look, then delete it"
    else
      say branch "$b: $ahead commit(s) not on $base"
    fi
  done <<<"$(git -C "$top" for-each-ref --format='%(refname:short)' refs/heads)"

  # Extra worktrees (the first entry is the checkout itself).
  local wt line wb dirty first=1
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }"; wb="" ;;
      "branch "*) wb="${line#branch refs/heads/}" ;;
      "" | end-of-list)
        if [ "$first" = 1 ]; then first=0; continue; fi
        [ -n "${wt:-}" ] && [ "$wt" != "$top" ] || continue
        ahead=0
        [ -n "$wb" ] && ahead="$(git -C "$top" rev-list --count "origin/$base..$wb" 2>/dev/null || echo 0)"
        dirty="$(git -C "$wt" status --porcelain 2>/dev/null | grep -c .)"
        # A clean worktree of a shipped branch is not work; one with uncommitted files still is.
        if [ "$dirty" -eq 0 ] && [ "$ahead" -gt 0 ] && shipped "$wb"; then ahead=0; fi
        if [ "$ahead" -gt 0 ] || [ "$dirty" -gt 0 ]; then
          say worktree "$wt [${wb:-detached}]: $ahead commit(s) not on $base, $dirty uncommitted file(s)"
          risky_changes "$wt" "worktree ${wb:-detached}"
        fi
        wt="" ;; # the last entry ends with a blank line and the marker: report it once
    esac
  # $(...) strips the blank line that ends the last entry; the marker ends it.
  done <<<"$(git -C "$top" worktree list --porcelain; echo end-of-list)"

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
  unanswered "$top"
}

# Comments and review bodies by others after the PR author's last comment or
# review. Prints the author and link, never the comment text.
unanswered() {
  local top="$1" json rows
  command -v jq >/dev/null 2>&1 || { say unknown "jq is not installed; unanswered comments not checked"; return 0; }
  json="$(cd "$top" && gh pr list --author @me --state open --limit 50 \
    --json number,author,comments,reviews 2>/dev/null)" || { say unknown "gh pr list failed; unanswered comments not checked"; return 0; }
  [ -n "$json" ] || return 0
  rows="$(printf '%s' "$json" | jq -r '.[] | .number as $n | .author.login as $me
    | ([.comments[]? | {who: .author.login, at: .createdAt, what: "comment", url: (.url // ""), body: (.body // "")}]
       + [.reviews[]? | select((.body // "") != "") | {who: .author.login, at: .submittedAt, what: "review", url: "", body: .body}]) as $all
    | ([$all[] | select(.who == $me) | .at] | max // "") as $last
    | $all[] | select(.who != $me and .at > $last)
    | [$n, .what, .who, .url, (.body | gsub("[\t\n\r]"; " "))] | @tsv' 2>/dev/null)" \
    || { say unknown "could not read pull request comments"; return 0; }
  local ignore_authors="${OPEN_WORK_IGNORE_AUTHORS:-^(github-actions|dependabot)(\[bot\])?$}"
  local ignore_bodies="${OPEN_WORK_IGNORE_BODIES:-}"
  local number what who url body
  while IFS=$'\t' read -r number what who url body; do
    [ -n "$number" ] || continue
    printf '%s' "$who" | grep -Eq -- "$ignore_authors" && continue
    [ -n "$ignore_bodies" ] && printf '%s' "$body" | grep -Eq -- "$ignore_bodies" && continue
    say reply "#$number $what by $who${url:+ $url}"
  done <<<"$rows"
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
