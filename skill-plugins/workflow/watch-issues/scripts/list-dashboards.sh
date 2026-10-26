#!/usr/bin/env bash
# List the claude.ai dashboards whose comments a watch pass reads.
#
# Each skill that keeps a dashboard saves its URL in
# ~/.local/state/<skill>/dashboard-url (one line). This prints one line per
# file: `<skill><TAB><url>`. It only reads; it never calls claude.ai.
# Lines that are not a claude.ai artifact URL are skipped with a `skip` line
# on stderr, so a stray file never becomes a URL the agent opens.
#
# Env: WATCH_DASHBOARD_STATE_DIR (default ~/.local/state), for tests.
set -euo pipefail

state="${WATCH_DASHBOARD_STATE_DIR:-$HOME/.local/state}"
[ -d "$state" ] || exit 0

for f in "$state"/*/dashboard-url; do
  [ -f "$f" ] || continue
  skill="$(basename "$(dirname "$f")")"
  url="$(head -n 1 "$f" | tr -d '[:space:]')"
  if printf '%s' "$url" | grep -Eq '^https://claude\.ai/(code/)?artifact/[A-Za-z0-9_-]+$'; then
    printf '%s\t%s\n' "$skill" "$url"
  else
    printf 'skip\t%s: not a claude.ai artifact URL\n' "$skill" >&2
  fi
done
