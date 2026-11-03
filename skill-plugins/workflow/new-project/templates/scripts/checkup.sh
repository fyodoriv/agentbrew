#!/usr/bin/env bash
# Repo-wide checkup: the whole health picture in one command.
# Fast on a quiet day (the gate is cached by input hash), full when anything changed.
# Run it before a work session and in the weekly checkup (RECURRING.md).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

rc=0
section() { printf '\n== %s\n' "$1"; }
# Keep a copy of everything printed: the end of the run turns it into an HTML page.
log="$(mktemp)"
exec > >(tee "$log") 2>&1

checkup_id="${CHECKUP_RUN_ID-{{NAME}}}"
checkup_record_available=0
checkup_record_incomplete=0
if ! command -v agentbrew >/dev/null 2>&1; then
  printf 'checkup record: unavailable (agentbrew is missing)\n'
elif ! (LC_ALL=C; [[ "$checkup_id" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]); then
  printf 'checkup record: incomplete (set CHECKUP_RUN_ID to a valid project ID)\n'
  checkup_record_incomplete=1
else
  checkup_record_available=1
  if ! agentbrew checkup-run show "$checkup_id"; then
    printf 'checkup record: previous run unavailable\n'
    checkup_record_incomplete=1
  fi
  checked_commit="$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || checked_commit=""
fi

section "Open work (your PRs, unmerged branches, uncommitted files)"
open_work="${WRAP_UP_SKILL:-$HOME/.claude/skills/wrap-up}/scripts/open-work.sh"
if [ -f "$open_work" ]; then
  if ! bash "$open_work" .; then
    rc=1
    echo "-> finish these first: conflicts, red checks, review comments, then merge (wrap-up skill, \"Continue open work\")"
  fi
else
  git status --short
  if command -v gh >/dev/null 2>&1; then gh pr list --author @me --state open || true; fi
  base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
  git branch --no-merged "$base" 2>/dev/null | grep -v -e tasks-claims -e dependabot/ || true
  git worktree list | sed -n '2,$p'
  echo "(wrap-up skill not installed; showed git status, your open PRs, unmerged branches and worktrees)"
fi

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

if [ "$checkup_record_available" = 1 ]; then
  result=green
  [ "$rc" = 0 ] || result=degraded
  if [ -z "$checked_commit" ] ||
    ! finished_at="$(node -p 'new Date().toISOString()' 2>/dev/null)" ||
    ! agentbrew checkup-run record "$checkup_id" --finished-at "$finished_at" \
      --result "$result" --commit "$checkup_id=$checked_commit"; then
    printf 'checkup record: incomplete\n'
    checkup_record_incomplete=1
  fi
fi

if [ "$rc" = 0 ] && [ "$checkup_record_incomplete" = 1 ]; then
  rc=2
fi
printf '\ncheckup: %s\n' "$([ "$rc" = 0 ] && echo healthy || echo "needs work (see above)")"
# The HTML page (verdict, blockers, next steps, every section) stays local in .metrics/.
scripts/report-html.sh "{{NAME}} checkup" "$log" .metrics/checkup.html &&
  printf 'report: %s\n' "$PWD/.metrics/checkup.html"
rm -f "$log"
exit "$rc"
