#!/usr/bin/env bash
# Repo-wide checkup: the whole health picture in one command.
# Fast on a quiet day (the gate is cached by input hash), full when anything changed.
# Run it before a work session and in the weekly checkup (RECURRING.md).
set -uo pipefail
cd "$(dirname "$0")/.."

rc=0
section() { printf '\n== %s\n' "$1"; }

section "Health"
scripts/doctor.sh || rc=1

section "Gate (cached by input hash; NO_CACHE=1 forces a full run)"
scripts/check.sh || rc=1

section "Broken stories (failed events by story)"
if [ -f .metrics/events.jsonl ]; then
  broken="$(grep '"ok":false' .metrics/events.jsonl | grep -oE '"story":"[^"]+"' | sort | uniq -c | sort -rn || true)"
  if [ -n "$broken" ]; then echo "$broken"; echo "-> each one is a P0 task"; else echo "none"; fi
else
  echo "no events yet"
fi

section "Speed"
scripts/metrics.sh

section "Open P0 tasks"
if [ -f TASKS.md ]; then
  awk '/^## P0/{f=1; next} /^## /{f=0} f && /^- \[ \]/' TASKS.md | sed 's/^- \[ \] /- /'
fi

section "Monthly requirements audit"
skill="${NEW_PROJECT_SKILL:-$HOME/.claude/skills/new-project}"
if [ -x "$skill/scripts/audit-due.sh" ]; then
  if "$skill/scripts/audit-due.sh" .; then
    echo "-> run it: $skill/references/requirements-map.md, section 4"
  fi
else
  echo "new-project skill not installed; skipped"
fi

printf '\ncheckup: %s\n' "$([ "$rc" = 0 ] && echo healthy || echo "needs work (see above)")"
exit "$rc"
