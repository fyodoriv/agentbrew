#!/usr/bin/env bash
# scripts/add-task.sh — append a properly-formatted task entry to
# agentbrew's TASKS.md.
#
# Parallel to dotfiles' bin/add-task. Same UX, different TASKS.md format:
# agentbrew uses un-nested metadata rows (`  **Field**: value`) rather
# than dotfiles' nested bullet rows (`  - **Field**: value`).
#
# What it does (and does NOT do):
#   - Generates a unique slug-style ID from the title.
#   - Inserts a properly-formatted entry under `## P<N>`.
#   - Runs `npx vitest run src/docs/tasks-md-output-cadence.test.ts` to
#     confirm format passes the same validator CI uses.
#   - PRINTS the next-steps (git add / commit / push) for you.
#   - Does NOT auto-commit or push — you stay in control of the git ops.
#
# Usage
#   scripts/add-task.sh                              # interactive prompts
#   scripts/add-task.sh --title "Fix X" --priority P1 --tags bug,foo
#   scripts/add-task.sh --help
#
# Flags
#   --title <text>      task title (required if non-interactive)
#   --priority P0..P3   priority section (default P2)
#   --id <slug>         ID override (default: slugified title)
#   --tags <csv>        comma-separated tags
#   --details <text>    free-form description
#   --files <csv>       comma-separated file paths the task touches
#   --acceptance <text> acceptance criteria
#   --dry-run           preview the entry without modifying TASKS.md
#   --help              this message
#
# Exit codes
#   0  task appended (or dry-run printed)
#   1  validation error (vitest validator failed after write)
#   2  bad args

set -o errexit -o nounset -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="$REPO_ROOT/TASKS.md"

TITLE=""
PRIORITY="P2"
ID=""
TAGS=""
DETAILS=""
FILES=""
ACCEPTANCE=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --title)      TITLE="$2"; shift 2 ;;
    --priority)   PRIORITY="$2"; shift 2 ;;
    --id)         ID="$2"; shift 2 ;;
    --tags)       TAGS="$2"; shift 2 ;;
    --details)    DETAILS="$2"; shift 2 ;;
    --files)      FILES="$2"; shift 2 ;;
    --acceptance) ACCEPTANCE="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --help|-h)
      sed -n '/^# Usage/,/^# See/p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$PRIORITY" in
  P0|P1|P2|P3) ;;
  *) echo "--priority must be one of P0 / P1 / P2 / P3 (got: $PRIORITY)" >&2; exit 2 ;;
esac

if [ -z "$TITLE" ] && [ -t 0 ]; then
  read -r -p "Title: " TITLE
fi
if [ -z "$TITLE" ]; then
  echo "--title is required" >&2
  exit 2
fi

if [ -z "$ID" ]; then
  ID=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
fi

# agentbrew TASKS.md format uses un-nested rows. The ID line shape is
# `  **ID**: <slug>` (two spaces of indent, no leading dash).
if grep -qE "^  \*\*ID\*\*: ${ID}\s*$" "$TASKS_FILE" 2>/dev/null; then
  echo "ID '$ID' already exists in $TASKS_FILE" >&2
  echo "Pass --id <unique-slug> to override." >&2
  exit 2
fi

# Build the entry. Use explicit `if` rather than `&&` to avoid set -e
# tripping on empty-var short-circuits.
build_entry() {
  printf -- '- [ ] %s\n' "$TITLE"
  printf -- '  **ID**: %s\n' "$ID"
  if [ -n "$TAGS" ];       then printf -- '  **Tags**: %s\n' "$TAGS";             fi
  if [ -n "$DETAILS" ];    then printf -- '  **Details**: %s\n' "$DETAILS";       fi
  if [ -n "$FILES" ];      then printf -- '  **Files**: %s\n' "$FILES";           fi
  if [ -n "$ACCEPTANCE" ]; then printf -- '  **Acceptance**: %s\n' "$ACCEPTANCE"; fi
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Would insert under ## $PRIORITY in $TASKS_FILE:"
  echo ""
  build_entry | sed 's/^/  /'
  exit 0
fi

ENTRY="$(build_entry)"
ENTRY_FILE="$(mktemp)"
trap 'rm -f "$ENTRY_FILE"' EXIT
printf '\n%s\n' "$ENTRY" > "$ENTRY_FILE"

awk -v section="## $PRIORITY" -v insert_file="$ENTRY_FILE" '
  $0 == section {
    print
    getline; print
    while ((getline line < insert_file) > 0) print line
    close(insert_file)
    next
  }
  { print }
' "$TASKS_FILE" > "$TASKS_FILE.tmp"

mv "$TASKS_FILE.tmp" "$TASKS_FILE"

echo "✓ inserted under ## $PRIORITY: $TITLE (id=$ID)"

# Optional: run the TASKS.md output validator if vitest + node_modules
# are available. We skip silently if not — the helper is meant to work
# even on a fresh clone before `npm install` finishes.
if [ -d "$REPO_ROOT/node_modules" ] && command -v npx >/dev/null 2>&1; then
  echo ""
  echo "Running tasks-md output validator…"
  if ! (cd "$REPO_ROOT" && npx vitest run src/docs/tasks-md-output-cadence.test.ts >/dev/null 2>&1); then
    echo ""
    echo "✗ tasks-md output validator failed — check the inserted entry in $TASKS_FILE"
    echo "  Revert: git checkout TASKS.md  (or fix manually)"
    exit 1
  fi
  echo "  ✓ validator passed"
fi

echo ""
echo "Next steps:"
echo "  cd $REPO_ROOT"
echo "  git diff TASKS.md            # review the change"
echo "  git add TASKS.md"
echo "  git commit -m \"docs(tasks): add $PRIORITY task — $TITLE PROJ-123\""
echo "  git push"
echo ""
echo "Push to a feature branch and open a PR on GitHub.com to land it."
