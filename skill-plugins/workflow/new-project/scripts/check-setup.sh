#!/usr/bin/env bash
# Score a repo's agent-ready setup for one new-project profile.
#
# Usage: check-setup.sh <repo-dir> --profile tool|assistant|side-project [--strict]
#
# Prints one PASS/FAIL line per check, then "score: N/M (P%)".
# Exit 0 only when every check passes. --strict also fails on "FILL:" markers
# that the scaffold leaves for the agent to replace with project facts.
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
check() {
  # check <label> <command...>: runs the command in the repo dir.
  label="$1"; shift
  total=$((total + 1))
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
  head -60 README.md | grep -q '^```' && head -60 README.md | grep -q 'docs/README.md'
}

gitignore_has() { grep -qE "^/?$1" .gitignore; }

no_tracked_env() {
  ! { git ls-files 2>/dev/null | grep -qE '(^|/)\.env($|\.)' && ! git ls-files | grep -qE '\.env\.example$'; }
}

has_any() { for f in "$@"; do [ -e "$f" ] && return 0; done; return 1; }

no_fill_markers() { ! grep -rIl --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=target --exclude-dir=dist 'FILL:' . ; }

# Common: every profile.
check "AGENTS.md exists and is under 10000 bytes" agents_small
check "AGENTS.md has the baseline sections in order" agents_sections_in_order
check "CLAUDE.md points to AGENTS.md" claude_points_to_agents
check "README.md has a quickstart block and links docs/README.md" readme_quickstart
check "docs/README.md docs map exists" test -f docs/README.md
check "docs/VISION.md has Problem, Non-goals and Success sections" \
  sh -c 'f=docs/VISION.md; grep -qE "^## +Problem" $f && grep -qE "^## +Non-goals" $f && grep -qE "^## +Success" $f'
check "docs/user-stories.md exists" test -f docs/user-stories.md
check "docs/decisions/ holds an ADR" sh -c 'ls docs/decisions/*.md >/dev/null 2>&1'
check "task backend declared (TASKS.md or .agents/tasks.config.yaml)" has_any TASKS.md .agents/tasks.config.yaml
check "Agentfile.yaml declares agent dependencies" test -f Agentfile.yaml
check "one-command gate scripts/check.sh is executable" test -x scripts/check.sh
check ".gitignore ignores .env files" gitignore_has '\.env'
check "no .env file is tracked by git" no_tracked_env

# Profile-specific checks.
case "$profile" in
  tool)
    check "CHANGELOG.md exists" test -f CHANGELOG.md
    check "LICENSE exists" test -f LICENSE
    ;;
  assistant)
    check "docs/privacy.md exists" test -f docs/privacy.md
    check ".gitignore ignores private/" gitignore_has 'private'
    check "config/models.yaml routes models (local first)" test -f config/models.yaml
    check "profile/USER.example.md shows the profile shape" test -f profile/USER.example.md
    check "memory/MEMORY.md shows the memory index shape" test -f memory/MEMORY.md
    check "prompts/ holds versioned prompts" sh -c 'ls prompts/*.md >/dev/null 2>&1'
    check "knowledge/README.md exists" test -f knowledge/README.md
    check "skills/ holds at least one assistant skill" sh -c 'ls skills/*/SKILL.md >/dev/null 2>&1'
    check "evals/run.sh is an executable runner" test -x evals/run.sh
    check "evals/ holds golden cases and a rubric" sh -c 'ls evals/cases/* >/dev/null 2>&1 && test -f evals/rubric.md'
    ;;
  side-project)
    check "docs/privacy.md exists" test -f docs/privacy.md
    check ".gitignore ignores private/" gitignore_has 'private'
    check "docs/VISION.md has Kill criteria" sh -c 'grep -qE "^## +Kill criteria" docs/VISION.md'
    ;;
esac

if [ "$strict" = 1 ]; then
  check "no FILL: markers left (strict)" no_fill_markers
fi

pct=$((pass * 100 / total))
echo "score: $pass/$total ($pct%)"
[ "$pass" -eq "$total" ]
