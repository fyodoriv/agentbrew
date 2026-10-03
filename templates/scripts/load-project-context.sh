#!/usr/bin/env bash
# load-project-context.sh — list a repo's canonical docs so an agent can read
# them before non-trivial work. Read-only. Spec: the `load-project-context`
# skill (skill-plugins/dev/load-project-context/SKILL.md in agentbrew).
#
# Usage: load-project-context.sh [dir]    (default: the current directory)
#
# `agentbrew sync` installs this file to ~/.config/agentbrew/scripts/ from
# agentbrew's templates/scripts/. It keeps any copy it did not write.
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no ${x,,}.
# Name matching runs in the shell, so the script forks only a few processes.

set -uo pipefail

MAX_ENTRIES=40
ROOT_FILES="readme.md agents.md claude.md contributing.md vision.md architecture.md roadmap.md milestones.md user_stories.md competitors.md prd.md tasks.md recurring.md backlog.md deprecated.md install.md changelog.md"
DOC_DIRS="user-stories competitors competition milestones architecture stories experiments plans rfcs adr"
DOCS_FILE_PATTERNS="*vision* *architecture* *roadmap* *milestone* *strategy* *user-stor* *competitor* *overview* *goals* *objectives* *charter* *north-star* *prd* *design* *spec*"

root=${1:-$PWD}
if [ ! -d "$root" ]; then
  echo "load-project-context: not a directory: $root" >&2
  exit 2
fi
root=$(cd "$root" && pwd -P)

entries=()

# scan_dir DIR: fill NAMES / KINDS / LOWERS with the entries of DIR.
scan_dir() {
  NAMES=()
  KINDS=()
  LOWERS=()
  local path lowered line
  for path in "$1"/*; do
    if [ -d "$path" ]; then KINDS+=(d); elif [ -f "$path" ]; then KINDS+=(f); else continue; fi
    NAMES+=("${path##*/}")
  done
  [ "${#NAMES[@]}" -eq 0 ] && return 0
  lowered=$(printf '%s\n' "${NAMES[@]}" | tr '[:upper:]' '[:lower:]')
  while IFS= read -r line; do LOWERS+=("$line"); done <<EOF
$lowered
EOF
}

# find_entry WANT KIND: set FOUND to the case-preserved name of a scanned entry.
find_entry() {
  FOUND=""
  local i=0
  while [ "$i" -lt "${#NAMES[@]}" ]; do
    if [ "${LOWERS[$i]}" = "$1" ] && [ "${KINDS[$i]}" = "$2" ]; then
      FOUND=${NAMES[$i]}
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

# add_dir REL: add "REL/ (N files; index: REL/README.md)" for a doc directory.
add_dir() {
  local rel=$1 count=0 index="" path noun="files"
  for path in "$root/$rel"/*; do
    [ -f "$path" ] || continue
    count=$((count + 1))
    case "${path##*/}" in
      [Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd] | [Ii][Nn][Dd][Ee][Xx].[Mm][Dd]) [ -z "$index" ] && index="$rel/${path##*/}" ;;
    esac
  done
  [ "$count" -eq 1 ] && noun="file"
  if [ -n "$index" ]; then
    entries+=("$rel/ ($count $noun; index: $index)")
  else
    entries+=("$rel/ ($count $noun)")
  fi
}

# add_doc_dirs PREFIX: add every canonical doc directory in the scanned dir.
add_doc_dirs() {
  local want
  for want in $DOC_DIRS; do
    find_entry "$want" d && add_dir "$1$FOUND"
  done
}

# 1. Canonical files at the root, in canonical order; 2. root doc directories.
scan_dir "$root"
for want in $ROOT_FILES; do
  find_entry "$want" f && entries+=("$FOUND")
done
add_doc_dirs ""

find_entry "agentfile.yaml" f || find_entry "agentfile" f
agentfile=$FOUND
has_tasks_md=""
find_entry "tasks.md" f && has_tasks_md=1
docs_dir=""
find_entry "docs" d && docs_dir=$FOUND

# 3. Matching top-level doc files under docs/, then docs/ doc directories.
if [ -n "$docs_dir" ]; then
  scan_dir "$root/$docs_dir"
  i=0
  while [ "$i" -lt "${#NAMES[@]}" ]; do
    lname=${LOWERS[$i]}
    if [ "${KINDS[$i]}" = f ]; then
      case "$lname" in
        *.md | *.mdx | *.markdown | *.txt | *.rst | *.adoc)
          set -f # split the pattern list without expanding it against the cwd
          for pattern in $DOCS_FILE_PATTERNS; do
            # shellcheck disable=SC2254 # $pattern is an intentional glob.
            case "$lname" in $pattern)
              entries+=("$docs_dir/${NAMES[$i]}")
              break
              ;;
            esac
          done
          set +f
          ;;
      esac
    fi
    i=$((i + 1))
  done
  add_doc_dirs "$docs_dir/"
fi

# Task backend: .tasksmd.json at the git root can move tasks to GitHub Issues.
git_root=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null) || git_root=$root
backend=""
if [ -f "$git_root/.tasksmd.json" ] && grep -Eq '"backend"[[:space:]]*:[[:space:]]*"github-issues"' "$git_root/.tasksmd.json"; then
  backend="github-issues (.tasksmd.json) — list and file tasks as GitHub Issues, not in TASKS.md"
elif [ -n "$has_tasks_md" ]; then
  backend="TASKS.md"
fi

echo "load-project-context @ $root"
total=${#entries[@]}
if [ "$total" -eq 0 ]; then
  echo "  no canonical docs found — this may not be a project root, or the repo does not use the canonical doc layout."
  [ -n "$agentfile" ] && echo "  Agentfile: $agentfile"
  exit 0
fi

shown=0
for entry in "${entries[@]}"; do
  [ "$shown" -ge "$MAX_ENTRIES" ] && break
  echo "  $entry"
  shown=$((shown + 1))
done
if [ "$total" -gt "$MAX_ENTRIES" ]; then
  echo "  +$((total - MAX_ENTRIES)) more (capped at $MAX_ENTRIES entries)"
fi
[ -n "$agentfile" ] && echo "  Agentfile: $agentfile"
[ -n "$backend" ] && echo "  task backend: $backend"
echo ""
echo "Read every listed file. Over 500 lines: read the table of contents, the first and last 100 lines, and the sections you need."
echo "For a directory, read its index file, or its first 3 files. Follow markdown links and @imports to depth 2."
exit 0
