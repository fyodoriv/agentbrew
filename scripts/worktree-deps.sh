#!/usr/bin/env bash
# Install node_modules in a fresh agentbrew worktree, fast.
#
# When the worktree's package-lock.json matches the main checkout's, clone the
# main checkout's node_modules with an APFS copy-on-write clone (`cp -cR`).
# The clone is a real copy, so tests see a normal tree; a symlinked
# node_modules breaks src/cli.test.ts. Otherwise run `npm ci`.
#
# Usage: run from the worktree root.
#   bash scripts/worktree-deps.sh [main-checkout]
# The main checkout defaults to the first entry of `git worktree list`.
# WORKTREE_DEPS_NPM overrides the npm binary (tests use a stub).
#
# <!-- scope: human-approved task worktree-deps-apfs-clone; this file closes it -->
set -euo pipefail

npm_bin="${WORKTREE_DEPS_NPM:-npm}"
target="$PWD"
main="${1:-}"
if [[ -z "$main" ]]; then
  main="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
fi

npm_ci() {
  echo "worktree-deps: $1; running npm ci"
  "$npm_bin" ci
}

if [[ ! -f "$target/package-lock.json" ]]; then
  echo "worktree-deps: no package-lock.json in $target" >&2
  exit 1
fi
if [[ "$(cd "$main" && pwd -P)" == "$(pwd -P)" ]]; then
  npm_ci "this is the main checkout"
  exit 0
fi
if [[ ! -d "$main/node_modules" ]]; then
  npm_ci "main checkout has no node_modules"
  exit 0
fi
if ! cmp -s "$target/package-lock.json" "$main/package-lock.json"; then
  npm_ci "package-lock.json differs from the main checkout"
  exit 0
fi

rm -rf "$target/node_modules"
if cp -cR "$main/node_modules" "$target/node_modules" 2>/dev/null; then
  echo "worktree-deps: cloned node_modules from $main (lockfiles match)"
else
  rm -rf "$target/node_modules"
  npm_ci "copy-on-write clone failed"
fi
