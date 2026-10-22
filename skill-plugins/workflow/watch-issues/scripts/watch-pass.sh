#!/usr/bin/env bash
# One watch pass: list what needs work in each repo, and mark what was not handled yet.
# Usage: watch-pass.sh [--include-p3] [--limit K] [--state-dir DIR] [REPO_DIR...]
#        watch-pass.sh [--state-dir DIR] --done "<kind> <key>" [--done ...]
#   With no REPO_DIR, it reads one path per line from ~/.config/watch-issues/repos,
#   else it watches the current git repo.
# It prints up to K (default 5) items not handled yet, in this order: broken PRs, issues
# the signed-in user filed, tasks (P0 to P2, file order), issues from others (one slot is
# kept for an issue from others when there is one). Each line is
#   new<TAB><kind> <key><TAB><text>
# where "<kind> <key>" is the exact --done argument. Then "watch: N new (showing S), M handled".
# A PR key carries its state and head commit, so a PR that breaks again shows up as new.
# It never changes a repo. --done appends handled items to the seen list; nothing else is written.
set -uo pipefail

include_p3=0
limit=5
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/watch-issues"
repos=()
done_items=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-p3) include_p3=1; shift ;;
    --limit) limit="${2:?--limit needs a number}"; shift 2 ;;
    --state-dir) state_dir="${2:?--state-dir needs a folder}"; shift 2 ;;
    --done) done_items+=("${2:?--done needs \"<kind> <key>\"}"); shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) repos+=("$1"); shift ;;
  esac
done

export GIT_TERMINAL_PROMPT=0
mkdir -p "$state_dir"
seen="$state_dir/seen"
touch "$seen"

if [ "${#done_items[@]}" -gt 0 ]; then
  for item in "${done_items[@]}"; do
    tab="$(printf '\t')"
    case "$item" in
      *"$tab"*|*" ") ok=0 ;;
      "task "?*) ok=1 ;;
      *) ok=0
         printf '%s\n' "$item" | grep -qE '^issue [^ /]+/[^ /]+#[0-9]+$' && ok=1
         printf '%s\n' "$item" | grep -qE '^pr [^ /]+/[^ /]+#[0-9]+ (red|conflicting) [0-9a-f]{7}$' && ok=1 ;;
    esac
    if [ "$ok" -ne 1 ]; then
      echo "watch: not an item key: $item (use the second column of a pass line)" >&2; exit 1
    fi
    grep -qxF "$item" "$seen" || printf '%s\n' "$item" >>"$seen"
  done
  echo "watch: recorded ${#done_items[@]} handled item(s)"
  exit 0
fi

if [ "${#repos[@]}" -eq 0 ]; then
  config="${WATCH_ISSUES_REPOS_FILE:-$HOME/.config/watch-issues/repos}"
  if [ -f "$config" ]; then
    while IFS= read -r line; do
      line="$(printf '%s' "$line" | sed -E 's/(^|[[:space:]])#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
      [ -n "$line" ] && repos+=("${line/#\~/$HOME}")
    done <"$config"
  fi
  if [ "${#repos[@]}" -eq 0 ]; then
    repos+=("$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
  fi
fi

new_count=0 open_count=0
buckets=$'pr\nowner\ntask\noutside'
work="$(mktemp -d "${TMPDIR:-/tmp}/watch-pass.XXXXXX")"
trap 'rm -rf "$work"' EXIT
for b in $buckets; do : >"$work/$b"; done
emit() { # emit <bucket> <kind> <key> <text>
  if grep -qxF "$2 $3" "$seen"; then
    open_count=$((open_count + 1))
  else
    printf 'new\t%s %s\t%s\n' "$2" "$3" "$4" >>"$work/$1"; new_count=$((new_count + 1))
  fi
}

# Ready task blocks in a TASKS.md text, as "<key>\t<title>". Skips P3 (unless asked), tasks
# claimed by an agent ("(@name)" title), tasks with a Blocked line, and tasks whose
# "Blocked by" IDs are still open in the file. A task without an ID is keyed by its title.
ready_tasks() {
  awk -v include_p3="$include_p3" '
    function flush() {
      if (title != "" && !blocked && !claimed && (include_p3 || prio != "P3")) {
        n++; keys[n] = (id != "" ? id : "title:" title); titles[n] = title; deps[n] = by
      }
      title = ""; id = ""; blocked = 0; claimed = 0; by = ""
    }
    /^## / { flush(); prio = $2; next }
    /^- \[ \] / { flush(); title = substr($0, 7); claimed = (title ~ /\(@[^)]*\)[[:space:]]*$/); next }
    /^  - \*\*ID\*\*:/ { id = $3; ids[id] = 1; next }
    /^  - \*\*Blocked\*\*:/ { blocked = 1; next }
    /^  - \*\*Blocked by\*\*:/ { by = $0; sub(/^  - \*\*Blocked by\*\*: */, "", by); next }
    END {
      flush()
      for (i = 1; i <= n; i++) {
        waiting = 0; m = split(deps[i], d, /[ ,]+/)
        for (j = 1; j <= m; j++) if (d[j] != "" && (d[j] in ids)) waiting = 1
        if (!waiting) printf "%s\t%s\n", keys[i], titles[i]
      }
    }'
}

me="$(gh api user --jq .login 2>/dev/null || true)"

for repo in "${repos[@]}"; do
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "skip  $repo: not a git checkout"; continue
  fi
  name="$(basename "$repo")"
  slug="$(git -C "$repo" config --get remote.origin.url 2>/dev/null |
    sed -nE 's#/*$##; s#\.git$##; s#.*github\.com[:/]+([^/]+/[^/]+)$#\1#p')"
  def="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  [ -n "$def" ] || def="$(git -C "$repo" ls-remote --symref origin HEAD 2>/dev/null |
    sed -nE 's#^ref: refs/heads/([^[:space:]]+)[[:space:]]+HEAD$#\1#p')"
  if [ -z "$def" ]; then
    echo "skip  $name: no default branch for origin (tasks not checked)"
  else
    git -C "$repo" fetch --quiet origin "$def" 2>/dev/null ||
      echo "skip  $name: git fetch failed (showing the last fetched queue)"
    if tasks="$(git -C "$repo" show "origin/$def:TASKS.md" 2>/dev/null)"; then
      while IFS="$(printf '\t')" read -r key title; do
        [ -n "$key" ] && emit task task "$name/$key" "$title"
      done < <(printf '%s\n' "$tasks" | ready_tasks)
    fi
  fi

  [ -n "$slug" ] || { echo "skip  $name: origin is not a GitHub repo (issues and PRs not checked)"; continue; }
  if issues="$(gh issue list -R "$slug" --state open --limit 50 --json number,title,author \
      --jq '.[] | "\(.number)\t\(.author.login)\t\(.title)"' 2>/dev/null)"; then
    while IFS="$(printf '\t')" read -r num who title; do
      [ -n "$num" ] || continue
      whose=outside; [ -n "$me" ] && [ "$who" = "$me" ] && whose=owner
      emit "$whose" issue "$slug#$num" "by $who ($whose): $title"
    done <<<"$issues"
  else
    echo "skip  $name: gh issue list failed (signed in? gh auth status)"
  fi

  # Your open PRs that need a fix. Drafts, PRs whose branch a worktree here has checked out,
  # and PRs updated in the last 30 minutes (another session may be on them) are left alone.
  busy="$(git -C "$repo" worktree list --porcelain 2>/dev/null | sed -n 's#^branch refs/heads/##p')"
  if prs="$(gh pr list -R "$slug" --author @me --state open --limit 50 \
      --json number,title,headRefName,headRefOid,isDraft,mergeable,statusCheckRollup,updatedAt \
      --jq '.[] | select(.isDraft | not)
          | select((now - (.updatedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) > 1800)
          | [.number, .headRefName, .headRefOid[0:7], .title,
          (if .mergeable == "CONFLICTING" then "conflicting"
           elif ([.statusCheckRollup[]? | (.conclusion // .state)]
                 | any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT"
                       or . == "STARTUP_FAILURE" or . == "ACTION_REQUIRED")) then "red"
           else "" end)] | @tsv' 2>/dev/null)"; then
    while IFS="$(printf '\t')" read -r num head sha title why; do
      [ -n "$num" ] && [ -n "$why" ] || continue
      printf '%s\n' "$busy" | grep -qxF "$head" && continue
      emit pr pr "$slug#$num $why $sha" "$title"
    done <<<"$prs"
  else
    echo "skip  $name: gh pr list failed (signed in? gh auth status)"
  fi
done

# One slot is kept for an outside issue (a user's report) when there is one, so reports
# never wait behind a long task queue.
reserve=0
[ -s "$work/outside" ] && [ "$limit" -ge 2 ] && reserve=1
shown=0
show() { # show <bucket> <max total>
  while IFS= read -r line; do
    [ "$shown" -lt "$2" ] || break
    printf '%s\n' "$line"; shown=$((shown + 1))
  done <"$work/$1"
}
for b in pr owner task; do show "$b" $((limit - reserve)); done
show outside "$limit"
echo "watch: $new_count new (showing $shown), $open_count handled"
exit 0
