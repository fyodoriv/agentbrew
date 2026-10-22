#!/usr/bin/env bash
# Inner-loop gate: it runs only the checks that the changed files can break.
# - A skill, hook, docs, rule-template, or task-queue diff runs the lints and
#   the tests that read those files, in seconds.
# - A code diff (src/, scripts/, real-e2e/, templates/) also runs the
#   typecheck and Biome when source files changed, and `vitest related` on the
#   changed source files, instead of the whole suite.
# - A change to the build or test setup (package files, tsconfig, vitest or
#   Biome config) runs the full `npm run verify`.
#
# When it passes, it prints a verdict:
# - "merge-ready": the diff touches only skill docs, evals, docs, rule
#   templates, root *.md files, or the task queue. No full gate is needed.
# - "run full npm run verify before merge": a hook, a skill script, or another
#   code path changed.
#
# Usage: bash scripts/verify-changed.sh [base-ref] [--dry-run]
#   base-ref defaults to origin/main. --dry-run prints the tests and the steps
#   it would run and the verdict, and exits without running any check.
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

# Files that every test or build depends on: only the full gate covers them.
full_gate_paths='^(package\.json|package-lock\.json|\.npmrc|\.node-version|tsconfig[^/]*\.json|tsup\.config\.ts|vitest[^/]*\.ts|biome\.json|knip\.json)$'
full="$(grep -E "$full_gate_paths" <<<"$changed" || true)"
if [[ -n "$full" ]]; then
  echo "verify:changed: these files need the full gate:"
  sed 's/^/  /' <<<"$full"
  [[ "$dry_run" == 1 ]] && exit 0
  exec npm run verify
fi

# Paths whose fast gate is enough for merge: prose and data that agents read,
# not code that runs. Hooks and skill scripts still need the full gate.
merge_ready_paths='^(skill-plugins/.*\.md$|skill-plugins/.*/evals/|docs/|templates/rules/|TASKS\.md$|RECURRING\.md$|[A-Za-z_-]+\.md$)'
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

has() { grep -qE "$1" <<<"$changed"; }

# The tests that read the changed files:
# - src/docs and src/oss always run. They scan the docs and the task queue,
#   and they hold the TASKS.md schema tests (an invalid **Output** fails).
# - A test runs when it names a changed file as the end of a quoted path
#   ("TASKS.md") or a changed skill as a quoted path part ("run-goal",
#   "/run-goal/"). A bare name in a comment ("See TASKS.md `id`") does not
#   count: it pulled in sync tests that never read the repo file.
# - Many tests write a fixture TASKS.md in a scratch repo. So for TASKS.md and
#   RECURRING.md, the name counts only on a line with a root path
#   (join(repoRoot, "TASKS.md"), process.cwd(), import.meta.dirname).
# - A skill change runs the src/skills tests, except a test that pins only
#   other skills (join(…, "skill-plugins", "<plugin>", "<skill>")): it reads
#   only its own skill. new-project-contract alone takes about 15 s.
# - A skill change also runs the tests that read every skill through code
#   (found with a read probe of the full suite, 2026-10-22).
# - A hook change runs src/hooks.
skill_scanners=(src/agent-bloat-lint.test.ts src/agent-artifacts/inventory.test.ts src/drift-checks/drift-checks.test.ts src/sync/helper-scripts.test.ts)
root_anchor='[A-Za-z_]*[Rr][Oo][Oo][Tt]|process\.cwd\(\)|import\.meta\.dirname|__dirname'
changed_skills=""
tests=(src/docs src/oss)

re_escape() { sed 's/[.[*^$()+?{}|]/\\&/g' <<<"$1"; }
add_tests_naming() {
  local t
  while IFS= read -r t; do tests+=("$t"); done < <(command -p grep -rlE --include='*.test.ts' -e "$1" src 2>/dev/null || true)
}
# True when test $1 pins skills and this diff changes none of them.
pins_other_skills() {
  local pins pin
  pins="$(command -p grep -oE '"skill-plugins", "[a-z0-9-]+", "[a-z0-9-]+"' "$1" | sed -E 's/.*"([a-z0-9-]+)"$/\1/' || true)"
  [[ -n "$pins" ]] || return 1
  while IFS= read -r pin; do
    grep -qxF -- "$pin" <<<"$changed_skills" && return 1
  done <<<"$pins"
  return 0
}

while IFS= read -r file; do
  [[ -e "$file" ]] || continue
  if [[ "$file" =~ ^skill-plugins/[^/]+/([^/]+)/ ]]; then
    skill="${BASH_REMATCH[1]}"
    changed_skills+="$skill"$'\n'
    add_tests_naming "[\"'/]$(re_escape "$skill")[\"'/]"
  fi
  case "$file" in
  skill-plugins/*/evals/evals.json | skill-plugins/*/SKILL.md) ;;
  TASKS.md | RECURRING.md) add_tests_naming "($root_anchor)[^;]*[\"']$(re_escape "$file")[\"']" ;;
  *) add_tests_naming "[\"'/]$(re_escape "$(basename "$file")")[\"']" ;;
  esac
done <<<"$changed"
if has '^skill-plugins/'; then
  tests+=("${skill_scanners[@]}")
  while IFS= read -r t; do
    pins_other_skills "$t" || tests+=("$t")
  done < <(command -p find src/skills -name '*.test.ts' 2>/dev/null | sort)
fi
has '^hooks/' && tests+=(src/hooks)

unique_tests=()
while IFS= read -r t; do
  [[ "$t" =~ ^src/(docs|oss)/ ]] && continue
  unique_tests+=("$t")
done < <(printf '%s\n' "${tests[@]}" | sort -u)

# Changed source files that still exist. `vitest related` runs every test
# that imports one of them (a changed test file counts as its own test).
code_re='^(src|scripts|real-e2e)/.*\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$'
code_files=()
while IFS= read -r f; do
  [[ -f "$f" ]] && code_files+=("$f")
done < <(grep -E "$code_re" <<<"$changed" || true)

if [[ "$dry_run" == 1 ]]; then
  echo "verify:changed: tests to run:"
  printf '  %s\n' "${unique_tests[@]}"
  if [[ "${#code_files[@]}" -gt 0 ]]; then
    echo "verify:changed: plus the tests related to:"
    printf '  %s\n' "${code_files[@]}"
  fi
  echo "verify:changed: steps:"
fi

# step <command...>: run it, or print it in a dry run.
step() {
  if [[ "$dry_run" == 1 ]]; then
    echo "  $*"
    return 0
  fi
  echo ""
  echo "▶ $*"
  "$@"
}

step node scripts/lint-tasks-stability.mjs TASKS.md
step node scripts/check-rule-8-pattern-conformance.mjs
step node scripts/check-rule-16-defaults.mjs
step bash scripts/lint-repo-artifacts.sh

# Typecheck and Biome only when source files changed (tsc covers deletions).
if has '^(src|scripts|real-e2e)/.*\.(ts|tsx|mts|cts)$'; then
  step npx tsc --noEmit
fi
if [[ "${#code_files[@]}" -gt 0 ]]; then
  step env LINT_CHANGED_BASE="$base_ref" bash scripts/lint-changed.sh
fi
if has '^(hooks|scripts|src)/'; then
  step bash scripts/lint-security.sh
fi

if has '^hooks/'; then
  if has '^hooks/(lib/|manifest\.yaml$)'; then
    step bash scripts/run-hook-fixtures.sh
  else
    # Keep single-hook test decisions out of the real decision log.
    if [[ "$dry_run" == 0 ]]; then
      HOOK_DECISIONS_LOG="$(mktemp "${TMPDIR:-/tmp}/hook-decisions.XXXXXX")"
      export HOOK_DECISIONS_LOG
    fi
    while IFS= read -r id; do
      [[ -f "hooks/checks/$id.test.sh" ]] && step bash "hooks/checks/$id.test.sh"
    done < <(grep -E '^hooks/checks/' <<<"$changed" | sed -E 's#^hooks/checks/##; s#(\.test)?\.sh$##' | sort -u)
  fi
fi

if has '^skill-plugins/'; then
  step npm run --silent skills:coverage
  step npm run --silent eval:agent-artifacts
fi

if [[ "${#code_files[@]}" -gt 0 ]]; then
  # `vitest related` needs files, so expand the always-run directories.
  related_args=()
  while IFS= read -r t; do related_args+=("$t"); done < <(
    for t in "${unique_tests[@]}"; do
      if [[ -d "$t" ]]; then command -p find "$t" -name '*.test.ts'; else printf '%s\n' "$t"; fi
    done | sort -u
  )
  step npx vitest related --run --passWithNoTests "${code_files[@]}" "${related_args[@]}"
else
  step npx vitest run "${unique_tests[@]}"
fi

# The install playbook drives the one-step install e2e (no-op for other paths).
step bash scripts/install-e2e-if-needed.sh "$base_ref"

if [[ "$dry_run" == 1 ]]; then
  verdict
  exit 0
fi

if [[ -f "$HOME/.config/oss-readiness/oss-readiness.env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.config/oss-readiness/oss-readiness.env"
  leaks="$(git diff "$base" | grep -icE -- "$OSS_READINESS_INTERNAL_PATTERN" || true)"
  echo ""
  echo "▶ leak check: $leaks match(es)"
  [[ "$leaks" == "0" ]] || exit 1
fi

verdict
