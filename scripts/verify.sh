#!/usr/bin/env bash
# The full gate (`npm run verify`): every check, in order, stopping at the
# first failure. Each step is timed into .metrics/gate-timings.jsonl, and a
# step that already passed on the same inputs is skipped.
#
# Cache key: a hash of every tracked and untracked (not ignored) file's path
# and content, the node version, the step command, and origin/main's commit.
# With a local installation, only steps independent of its contents use this
# cache. Other steps run fresh because this key has no installation receipt.
# Files outside the repo are not in the key. NO_CACHE=1 always runs all steps.
# A step named in step_inputs is keyed on its listed paths only (plus the node
# version and its command), so it stays cached while other files change.
#
# The cache lives in the git common dir, so every worktree of this repo shares
# it: a key is a file name, and a pass in one worktree skips the same step on
# the same inputs in another (hook-fixtures, for example). Keys older than 14
# days are pruned. AGENTBREW_GATE_CACHE_DIR overrides the location.
#
# Usage: bash scripts/verify.sh            (npm run verify)
#        NO_CACHE=1 bash scripts/verify.sh
# Runs under macOS /bin/bash 3.2.
# <!-- scope: human-approved task meet-new-project-requirements (TASKS.md); this file closes steps 7 and 8 -->
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1
# Gate runs call the CLI (skills:coverage); keep them out of the event log.
export AGENTBREW_EVENTS=0
metrics_dir="${AGENTBREW_METRICS_DIR:-.metrics}"
common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$metrics_dir")"
cache_dir="${AGENTBREW_GATE_CACHE_DIR:-$common_dir/agentbrew-gate-cache}"
timings="$metrics_dir/gate-timings.jsonl"
mkdir -p "$cache_dir" "$metrics_dir"
find "$cache_dir" -type f -mtime +14 -delete 2>/dev/null || true

now_ms() { node -e 'console.log(Date.now())'; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# input_hash [paths...]: one hash over the path and content of every file the
# repo holds, or of the files under the given paths only (then origin/main is
# not in the key).
input_hash() {
  {
    node --version
    if [ "$#" = 0 ]; then
      git rev-parse -q --verify origin/main 2>/dev/null || echo no-origin-main
    fi
    git ls-files -co --exclude-standard -- "$@" | sort -u | while IFS= read -r f; do
      [ -f "$f" ] && printf '%s\n' "$f"
    done >"$metrics_dir/.gate-files"
    paste "$metrics_dir/.gate-files" <(git hash-object --stdin-paths <"$metrics_dir/.gate-files")
  } | git hash-object --stdin
}

# step_inputs <name>: the paths a step depends on, when it is not the whole repo.
step_inputs() {
  case "$1" in
  lockfile-sync) echo "package.json package-lock.json scripts/check-lockfile-sync.sh scripts/stubs" ;;
  # The fixtures run hook scripts, the perf helper, and the wrap-up skill's
  # open-work script (src/scripts/verify-cache.test.ts checks this list).
  hook-fixtures) echo "hooks templates/scripts skill-plugins/workflow/wrap-up scripts/run-hook-fixtures.sh" ;;
  esac
}

# Only these exact commands use source without the checkout's installed packages.
source_only_step() {
  local tools resolver tool path actual
  case "$*" in
    "hook-fixtures bash scripts/run-hook-fixtures.sh")
      [ "${HOOK_FIXTURES_HOST_ENV:-0}" != 1 ] && [ -z "${HOOK_FIXTURE_BASH:-}" ] || return 1
      tools="mktemp ln jq env rm"
      ;;
    "lint-security bash scripts/lint-security.sh") tools="grep sed" ;;
    "lint-artifacts bash scripts/lint-repo-artifacts.sh")
      local artifact
      artifact="$(/usr/bin/find . -maxdepth 1 -type f -name '=*' -print -quit)" || return 1
      [ -z "$artifact" ] || return 1
      tools="basename sed"
      ;;
    "lint-tasks node scripts/lint-tasks-stability.mjs TASKS.md") tools="" ;;
    *) return 2 ;;
  esac

  resolver=/bin/realpath
  [ -x "$resolver" ] || resolver=/usr/bin/realpath
  [ -x "$resolver" ] || return 1
  actual="$(cd -P node_modules 2>/dev/null && pwd -P)" || actual="$PWD/node_modules"
  path="$("$resolver" "$3")" || return 1
  case "$path" in
    "$actual/"* | "$PWD/node_modules/"*) return 1 ;;
    "$PWD/"*) ;;
    *) return 1 ;;
  esac
  # shellcheck disable=SC2086 # This list contains fixed tool names.
  for tool in bash git node sort paste mkdir find $tools; do
    [ "$(type -t "$tool")" = file ] || return 1
    path="$(command -v "$tool")" || return 1
    case "$path" in
      "$PWD/node_modules/"* | node_modules/* | ./node_modules/*) return 1 ;;
    esac
    path="$("$resolver" "$path")" || return 1
    case "$path" in
      "$actual/"* | "$PWD/node_modules/"*) return 1 ;;
    esac
  done
}

cache_scope() {
  local qualification=0
  [ -z "${BASH_ENV:-}${ENV:-}${NODE_OPTIONS:-}${NODE_PATH:-}" ] || return 0
  source_only_step "$@" || qualification=$?
  if [ "$qualification" = 0 ]; then
    printf '%s\n' source-only
  elif [ "$qualification" = 2 ] && [ -n "${VERIFY_PLAN:-}" ] && [ ! -e node_modules ] && [ ! -L node_modules ]; then
    # Keep the no-install cache for the explicit synthetic plan port only.
    printf '%s\n' fixture-no-local-install
  fi
}

inputs="$(input_hash)"
gate_start="$(now_ms)"
steps=0
cached_steps=0

finish() {
  local ok="$1"
  local ms=$(($(now_ms) - gate_start))
  local forced=false
  [ "${NO_CACHE:-0}" = 1 ] && forced=true
  printf '{"ts":"%s","event":"gate","mode":"full","ms":%s,"ok":%s,"steps":%s,"cached_steps":%s,"forced":%s}\n' \
    "$(ts)" "$ms" "$ok" "$steps" "$cached_steps" "$forced" >>"$timings"
}

# step <name> <command...>: skip on a cache hit, else run, time, and record.
step() {
  local name="$1"
  shift
  steps=$((steps + 1))
  local scope key="" base="$inputs" paths
  scope="$(cache_scope "$name" "$@")"
  if [ -n "$scope" ]; then
    paths="$(step_inputs "$name")"
    # shellcheck disable=SC2086 # the path list splits on spaces by design
    [ -z "$paths" ] || base="$(input_hash $paths)"
    key="$(printf 'cache-v2\n%s\n%s\n%s\n' "$scope" "$base" "$*" | git hash-object --stdin)"
  fi
  if [ -n "$key" ] && [ "${NO_CACHE:-0}" != 1 ] && [ -f "$cache_dir/$name/$key" ]; then
    cached_steps=$((cached_steps + 1))
    touch "$cache_dir/$name/$key"
    echo "--- $name: cached (inputs unchanged since it passed)"
    printf '{"ts":"%s","event":"step","step":"%s","ms":0,"ok":true,"cached":true}\n' "$(ts)" "$name" >>"$timings"
    return 0
  fi
  echo ""
  echo "==> $name: $*"
  local start rc
  start="$(now_ms)"
  "$@"
  rc=$?
  local ms=$(($(now_ms) - start))
  local ok=true
  [ "$rc" = 0 ] || ok=false
  printf '{"ts":"%s","event":"step","step":"%s","ms":%s,"ok":%s,"cached":false}\n' "$(ts)" "$name" "$ms" "$ok" >>"$timings"
  if [ "$rc" != 0 ]; then
    [ -z "$key" ] || rm -f "$cache_dir/$name/$key"
    echo "--- $name: FAILED in ${ms} ms (rc=$rc)"
    finish false
    exit "$rc"
  fi
  if [ -n "$key" ] && [ "$(cache_scope "$name" "$@")" = "$scope" ]; then
    mkdir -p "$cache_dir/$name" && : >"$cache_dir/$name/$key"
  fi
  echo "--- $name: ok in ${ms} ms"
}

# The steps, one per line: <name> <command...> (no quoting; tests swap the
# plan through VERIFY_PLAN=<file>).
default_plan() {
  cat <<'PLAN'
lockfile-sync bash scripts/check-lockfile-sync.sh
build-pipeline bash scripts/build-pipeline-guard.sh --full
typecheck npx tsc --noEmit
biome npx biome check src scripts real-e2e --error-on-warnings
lint-security bash scripts/lint-security.sh
leak-audit npx tsx src/cli.ts plugin leak-audit
lint-artifacts bash scripts/lint-repo-artifacts.sh
hook-fixtures bash scripts/run-hook-fixtures.sh
lint-tasks node scripts/lint-tasks-stability.mjs TASKS.md
tasks-md-lint npx --yes @tasks-md/lint@0.10.2 --require-prereg TASKS.md
rule-3 node scripts/check-rule-3-test-first.mjs
rule-8 node scripts/check-rule-8-pattern-conformance.mjs
rule-16 node scripts/check-rule-16-defaults.mjs
lint-rules npm run --silent lint:rules
knip npx knip --no-progress
eval-agent-artifacts npm run --silent eval:agent-artifacts
skills-coverage npm run --silent skills:coverage
playwright-install npm run --silent playwright:install
chat-rule-controls bash scripts/run-chat-rule-controls.sh
chat-rule-schema-controls bash scripts/run-chat-rule-schema-controls.sh
test-all npx vitest run
install-e2e bash scripts/install-e2e-if-needed.sh
PLAN
}

plan_file="$metrics_dir/.gate-plan"
if [ -n "${VERIFY_PLAN:-}" ]; then cp "$VERIFY_PLAN" "$plan_file"; else default_plan >"$plan_file"; fi
while read -r -a line; do
  [ "${#line[@]}" -gt 1 ] || continue
  step "${line[@]}" </dev/null
done <"$plan_file"

finish true
echo ""
echo "verify: passed; $cached_steps of $steps steps from cache. Timings: $timings"
