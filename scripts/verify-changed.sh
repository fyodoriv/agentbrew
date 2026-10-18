#!/usr/bin/env bash
# Fast gate for a diff that touches only skills, hooks, docs, rule templates,
# or the task queue. It runs the checks those paths can break, in seconds.
# Any other changed path (src/, scripts/, package files, configs) runs the
# full `npm run verify` instead.
#
# When it passes, it prints a verdict:
# - "merge-ready": the diff touches only skill docs, evals, docs, rule
#   templates, root *.md files, or the task queue. No full gate is needed.
# - "run full npm run verify before merge": a hook, a skill script, or another
#   code path changed.
#
# Usage: bash scripts/verify-changed.sh [base-ref] [--dry-run]
#   base-ref defaults to origin/main. --dry-run prints the verdict and exits
#   without running any check.
#
# <!-- scope: human-approved task verify-changed-fast-gate (filed in #132); this file closes it -->
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
base_ref="origin/main"
dry_run=0
for arg in "$@"; do
  case "$arg" in
  --dry-run) dry_run=1 ;;
  *) base_ref="$arg" ;;
  esac
done
base="$(git merge-base HEAD "$base_ref")"

changed="$(
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u
)"
if [[ -z "$changed" ]]; then
  echo "verify:changed: no changes against $base_ref"
  exit 0
fi

fast_paths='^(skill-plugins/|hooks/|docs/|templates/rules/|TASKS\.md$|RECURRING\.md$|\.prereg-allowlist$|[A-Za-z_-]+\.md$)'
other="$(grep -vE "$fast_paths" <<<"$changed" || true)"
if [[ -n "$other" ]]; then
  echo "verify:changed: these files need the full gate:"
  sed 's/^/  /' <<<"$other"
  [[ "$dry_run" == 1 ]] && exit 0
  exec npm run verify
fi

# Paths whose fast gate is enough for merge: prose and data that agents read,
# not code that runs. Hooks and skill scripts still need the full gate.
merge_ready_paths='^(skill-plugins/.*\.md$|skill-plugins/.*/evals/|docs/|templates/rules/|TASKS\.md$|RECURRING\.md$|\.prereg-allowlist$|[A-Za-z_-]+\.md$)'
needs_full="$(grep -vE "$merge_ready_paths" <<<"$changed" || true)"

verdict() {
  echo ""
  if [[ -z "$needs_full" ]]; then
    echo "verify:changed: merge-ready. The diff touches only skill, eval, docs, rules, or task-queue paths; no full gate is needed."
  else
    echo "verify:changed passed. These code paths changed, so run full npm run verify before merge:"
    sed 's/^/  /' <<<"$needs_full"
  fi
}

if [[ "$dry_run" == 1 ]]; then
  verdict
  exit 0
fi

step() {
  echo ""
  echo "▶ $*"
  "$@"
}

has() { grep -qE "$1" <<<"$changed"; }

# Tests that name a changed file or its skill directory, plus the docs and
# leak tests, which read many of these files.
tests=(src/docs src/oss)
while IFS= read -r file; do
  [[ -e "$file" ]] || continue
  name="$(basename "$file")"
  case "$file" in
  skill-plugins/*/evals/evals.json) name="$(basename "${file%/evals/evals.json}")" ;;
  skill-plugins/*/SKILL.md) name="$(basename "$(dirname "$file")")" ;;
  esac
  while IFS= read -r t; do tests+=("$t"); done < <(command -p grep -rlF --include='*.test.ts' -e "$name" src 2>/dev/null || true)
done <<<"$changed"
has '^skill-plugins/' && tests+=(src/skills)
has '^hooks/' && tests+=(src/hooks)

step node scripts/lint-tasks-stability.mjs TASKS.md
step node scripts/check-rule-8-pattern-conformance.mjs
step node scripts/check-rule-16-defaults.mjs
step bash scripts/lint-repo-artifacts.sh

if has '^hooks/'; then
  step bash scripts/lint-security.sh
  if has '^hooks/(lib/|manifest\.yaml$)'; then
    step bash scripts/run-hook-fixtures.sh
  else
    # Keep single-hook test decisions out of the real decision log.
    HOOK_DECISIONS_LOG="$(mktemp "${TMPDIR:-/tmp}/hook-decisions.XXXXXX")"
    export HOOK_DECISIONS_LOG
    while IFS= read -r id; do
      [[ -f "hooks/checks/$id.test.sh" ]] && step bash "hooks/checks/$id.test.sh"
    done < <(grep -E '^hooks/checks/' <<<"$changed" | sed -E 's#^hooks/checks/##; s#(\.test)?\.sh$##' | sort -u)
  fi
fi

if has '^skill-plugins/'; then
  step npm run --silent skills:coverage
  step npm run --silent eval:agent-artifacts
fi

unique_tests=()
while IFS= read -r t; do unique_tests+=("$t"); done < <(printf '%s\n' "${tests[@]}" | sort -u)
step npx vitest run "${unique_tests[@]}"

# The install playbook drives the one-step install e2e (no-op for other paths).
step bash scripts/install-e2e-if-needed.sh "$base_ref"

if [[ -f "$HOME/.config/oss-readiness/oss-readiness.env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.config/oss-readiness/oss-readiness.env"
  leaks="$(git diff "$base" | grep -icE -- "$OSS_READINESS_INTERNAL_PATTERN" || true)"
  echo ""
  echo "▶ leak check: $leaks match(es)"
  [[ "$leaks" == "0" ]] || exit 1
fi

verdict
