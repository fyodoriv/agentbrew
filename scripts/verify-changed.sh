#!/usr/bin/env bash
# Fast gate for a diff that touches only skills, hooks, docs, rule templates,
# or the task queue. It runs the checks those paths can break, in seconds.
# Any other changed path (src/, scripts/, package files, configs) runs the
# full `npm run verify` instead. The full gate still runs once before merge.
#
# Usage: bash scripts/verify-changed.sh [base-ref]   (default: origin/main)
#
# <!-- scope: human-approved task verify-changed-fast-gate (filed in #132); this file closes it -->
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
base_ref="${1:-origin/main}"
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
  exec npm run verify
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

echo ""
echo "verify:changed passed. Run the full npm run verify once before merge."
