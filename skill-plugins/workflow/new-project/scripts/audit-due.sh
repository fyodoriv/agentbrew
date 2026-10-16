#!/usr/bin/env bash
# Say whether a repo's monthly requirements audit is due, or record that it ran.
#
# Usage: audit-due.sh <repo-dir> [--days N]   prints "due" (exit 0) or "not due, last run YYYY-MM-DD" (exit 1)
#        audit-due.sh <repo-dir> --record     stamps today as the last run
#
# State lives outside the repo: ${XDG_STATE_HOME:-~/.local/state}/new-project-audit/<repo-name>.last
# Runs under macOS /bin/bash 3.2.
set -euo pipefail

usage() { echo "usage: audit-due.sh <repo-dir> [--days N | --record]" >&2; exit 2; }
dir="" days=30 record=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days) [ $# -ge 2 ] || usage; days="$2"; shift 2 ;;
    --record) record=1; shift ;;
    -h|--help) usage ;;
    *) dir="$1"; shift ;;
  esac
done
[ -n "$dir" ] && [ -d "$dir" ] || usage

state="${XDG_STATE_HOME:-$HOME/.local/state}/new-project-audit"
stamp="$state/$(basename "$(cd "$dir" && pwd)").last"

if [ "$record" = 1 ]; then
  mkdir -p "$state"
  date +%Y-%m-%d > "$stamp"
  echo "recorded $(cat "$stamp") in $stamp"
  exit 0
fi

[ -f "$stamp" ] || { echo "due (never run)"; exit 0; }
last="$(cat "$stamp")"
# Days since the last run, with BSD date (macOS) or GNU date.
last_s="$(date -j -f %Y-%m-%d "$last" +%s 2>/dev/null || date -d "$last" +%s)"
age=$(( ($(date +%s) - last_s) / 86400 ))
if [ "$age" -ge "$days" ]; then echo "due (last run $last, $age days ago)"; exit 0; fi
echo "not due, last run $last ($age days ago)"
exit 1
