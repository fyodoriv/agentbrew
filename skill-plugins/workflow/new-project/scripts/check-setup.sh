#!/usr/bin/env bash
# Score a repo's agent-ready setup for one new-project profile.
#
# Usage: check-setup.sh <repo-dir> --profile tool|assistant|side-project [--strict]
#
# Prints one PASS/FAIL line per check, then "score: N/M (P%)".
# Exit 0 only when every check passes. --strict also fails on "FILL" markers
# that the scaffold leaves for the agent to replace with project facts.
#
# An existing repo can push back through .agents/requirements.yaml (flat lines):
#   map.<area>: <path> [<path>...]   the repo's own files satisfy this area
#                                    (replaces the area's default checks; all paths must exist)
#   waive.<area>: <reason>           the area does not fit this repo; printed on every run
# See references/requirements-map.md.
# Runs under macOS /bin/bash 3.2: no associative arrays, no ${var,,}.
set -u

usage() {
  echo "usage: check-setup.sh <repo-dir> --profile tool|assistant|side-project [--strict]" >&2
  exit 2
}

dir=""
profile=""
strict=0
while [ $# -gt 0 ]; do
  [ "$1" != --profile ] || [ $# -ge 2 ] || usage
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --strict) strict=1; shift ;;
    -h|--help) usage ;;
    *) dir="$1"; shift ;;
  esac
done
[ -n "$dir" ] && [ -d "$dir" ] || usage
case "$profile" in tool|assistant|side-project) ;; *) usage ;; esac

pass=0
total=0
labels=""
waived=0
mapped_done=" "
reqfile="$dir/.agents/requirements.yaml"
req_get() { [ -f "$reqfile" ] && grep -E "^$1:" "$reqfile" | head -1 | sed -E "s/^$1:[[:space:]]*//"; }

mapped_paths_exist() { for f in "$@"; do [ -e "$f" ] || return 1; done; }

check() {
  # check <label> <command...>: runs the command in the repo dir.
  label="$1"; shift
  area="$(printf '%s' "$label" | sed -nE 's/^\[([a-z0-9-]+)\].*/\1/p')"
  if [ -n "$area" ] && [ "$area" != strict ]; then
    reason="$(req_get "waive.$area" || true)"
    if [ -n "$reason" ]; then
      total=$((total + 1)); pass=$((pass + 1)); waived=$((waived + 1))
      labels="$labels
$label"
      echo "WAIVED $label -- $reason"
      return
    fi
    paths="$(req_get "map.$area" || true)"
    if [ -n "$paths" ]; then
      case "$mapped_done" in *" $area "*) return ;; esac
      mapped_done="$mapped_done$area "
      label="[$area] mapped to $paths"
      set -- mapped_paths_exist $paths
    fi
  fi
  total=$((total + 1))
  labels="$labels
$label"
  if (cd "$dir" && "$@") >/dev/null 2>&1; then
    pass=$((pass + 1)); echo "PASS $label"
  else
    echo "FAIL $label"
  fi
}

agents_small() { [ -f AGENTS.md ] && [ "$(wc -c < AGENTS.md)" -lt 10000 ]; }

agents_sections_in_order() {
  last=0
  for h in "Start here" "Commands" "Where to change what" "Rules" "Gotchas" "Delivery" "Docs upkeep"; do
    n="$(grep -nE "^## +$h" AGENTS.md | head -1 | cut -d: -f1)"
    [ -n "$n" ] && [ "$n" -gt "$last" ] || return 1
    last="$n"
  done
}

claude_points_to_agents() {
  if [ -L CLAUDE.md ]; then [ "$(readlink CLAUDE.md)" = "AGENTS.md" ]; else grep -qx '@AGENTS.md' CLAUDE.md; fi
}

readme_quickstart() {
  test -x scripts/setup.sh || return 1
  first="$(head -60 README.md | awk '/^```/{f=!f; next} f{print; exit}')"
  printf '%s' "$first" | grep -q 'scripts/setup.sh' && head -60 README.md | grep -q 'docs/README.md'
}

gitignore_has() { grep -qE "^/?$1" .gitignore; }

no_tracked_env() {
  ! { git ls-files 2>/dev/null | grep -qE '(^|/)\.env($|\.)' && ! git ls-files | grep -qE '\.env\.example$'; }
}

has_any() { for f in "$@"; do [ -e "$f" ] && return 0; done; return 1; }

no_fill_markers() { ! grep -rIl --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=target --exclude-dir=dist --exclude-dir=.metrics -w 'FILL' . ; }

# Common: every profile. Each label starts with the required area it proves.
check "[agents] AGENTS.md exists and is under 10000 bytes" agents_small
check "[agents] AGENTS.md has the baseline sections in order" agents_sections_in_order
check "[agents] CLAUDE.md points to AGENTS.md" claude_points_to_agents
check "[docs] docs/README.md docs map exists and check-docs.sh runs" sh -c 'test -f docs/README.md && test -x scripts/check-docs.sh'
check "[vision] docs/VISION.md has Problem, Non-goals, Success, Kill criteria" \
  sh -c 'f=docs/VISION.md; for h in Problem Non-goals Success "Kill criteria"; do grep -qE "^## +$h" $f || exit 1; done'
check "[metrics] docs/observability.md has a Metrics table with Goal and Pivot" \
  sh -c 'grep -qE "^## +Metrics" docs/observability.md && grep -qE "^\| *Metric *\| *Goal *\| *Pivot" docs/observability.md'
check "[metrics] scripts/metrics.sh reports speed" test -x scripts/metrics.sh
check "[observability] docs/observability.md has Logs, Errors, Health check" \
  sh -c 'for h in Logs Errors "Health check"; do grep -qE "^## +$h" docs/observability.md || exit 1; done'
check "[observability] scripts/doctor.sh health check is executable" test -x scripts/doctor.sh
check "[user-stories] docs/user-stories.md maps stories to e2e tests" sh -c 'grep -q "tests/e2e/" docs/user-stories.md'
check "[setup] one-line setup scripts/setup.sh, first in the README quickstart, and a docs/README.md link in the first 60 lines" readme_quickstart
check "[e2e] scripts/e2e.sh runs at least one tests/e2e test" sh -c 'test -x scripts/e2e.sh && ls tests/e2e/* >/dev/null 2>&1'
check "[self-improving] check.sh logs step timings to .metrics/" sh -c 'test -x scripts/check.sh && grep -q ".metrics/events.jsonl" scripts/check.sh'
check "[self-improving] RECURRING.md schedules a speed review" sh -c 'grep -qi "speed review" RECURRING.md'
check "[self-improving] docs/learnings.md logs predicted vs observed" sh -c 'grep -q "Predicted" docs/learnings.md'
check "[checkup] scripts/checkup.sh is the repo-wide checkup command" test -x scripts/checkup.sh
check "[start] one command starts the app: commands/<name>.md declared in Agentfile.yaml, and the README names the start and config set" sh -c 'ls commands/*.md >/dev/null 2>&1 && grep -q "^commands:" Agentfile.yaml && grep -q "config set" README.md'
check "[actions] every action runs via CLI, agents, and UI: the README names '<name> actions --json' and a parity test exists" sh -c 'grep -q "actions --json" README.md && find . -path ./node_modules -prune -o -name "*parity*" -print | grep -q .'
check "[checkup] scripts/checkup.sh lists open PRs and branches first" sh -c 'grep -qE "open-work|gh pr list" scripts/checkup.sh'
check "[caching] check.sh skips unchanged steps by input hash (NO_CACHE=1 forces a full run)" \
  sh -c 'grep -q "NO_CACHE" scripts/check.sh && grep -q "cache" scripts/check.sh'
check "[tasks] task backend declared (TASKS.md or .agents/tasks.config.yaml)" has_any TASKS.md .agents/tasks.config.yaml
check "[decisions] docs/decisions/ holds an ADR" sh -c 'ls docs/decisions/*.md >/dev/null 2>&1'
check "[agents] Agentfile.yaml declares agent dependencies" test -f Agentfile.yaml
check "[secrets] .gitignore ignores .env and .metrics/" sh -c 'grep -qE "^/?\.env" .gitignore && grep -qE "^/?\.metrics" .gitignore'
check "[secrets] no .env file is tracked by git" no_tracked_env

# Profile-specific checks.
case "$profile" in
  tool)
    check "[tool] CHANGELOG.md exists" test -f CHANGELOG.md
    check "[tool] LICENSE exists" test -f LICENSE
    ;;
  assistant)
    check "[profile] docs/privacy.md exists" test -f docs/privacy.md
    check "[profile] .gitignore ignores private/" gitignore_has 'private'
    check "[profile] config/models.yaml routes models (local first)" test -f config/models.yaml
    check "[profile] profile/USER.example.md shows the profile shape" test -f profile/USER.example.md
    check "[profile] memory/MEMORY.md shows the memory index shape" test -f memory/MEMORY.md
    check "[profile] prompts/ holds versioned prompts" sh -c 'ls prompts/*.md >/dev/null 2>&1'
    check "[profile] knowledge/README.md exists" test -f knowledge/README.md
    check "[profile] skills/ holds at least one assistant skill" sh -c 'ls skills/*/SKILL.md >/dev/null 2>&1'
    check "[profile] evals/run.sh is an executable runner" test -x evals/run.sh
    check "[profile] evals/ holds golden cases and a rubric" sh -c 'ls evals/cases/* >/dev/null 2>&1 && test -f evals/rubric.md'
    ;;
  side-project)
    check "[profile] docs/privacy.md exists" test -f docs/privacy.md
    check "[profile] .gitignore ignores private/" gitignore_has 'private'
    check "[profile] docs/VISION.md has Kill criteria" sh -c 'grep -qE "^## +Kill criteria" docs/VISION.md'
    ;;
esac

if [ "$strict" = 1 ]; then
  check "[strict] no FILL markers left" no_fill_markers
fi

areas="$(echo "$labels" | grep -oE '^\[[a-z0-9-]+\]' | sort -u | tr -d '[]' | tr '\n' ' ')"
echo "areas: $areas"
[ "$waived" -eq 0 ] || echo "waived: $waived (reasons above; review them in the monthly audit)"
pct=$((pass * 100 / total))
echo "score: $pass/$total ($pct%)"
[ "$pass" -eq "$total" ]
