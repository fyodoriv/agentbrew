#!/usr/bin/env bash
# Install node_modules in a fresh agentbrew worktree, fast.
#
# When the worktree's package-lock.json matches the main checkout's, clone the
# main checkout's node_modules with an APFS copy-on-write clone. One
# clonefile(2) call on the directory clones the whole tree in the kernel, in
# about 1 s; `cp -cR` clones file by file and takes about 15 s, so it is only
# the fallback. The clone is a real copy, so tests see a normal tree; a
# symlinked node_modules breaks src/cli.test.ts. Otherwise run `npm ci`.
#
# After a clone, node_modules/.worktree-deps-lock.json holds the lockfile it
# matches. A re-run with the same lockfile keeps node_modules and exits.
#
# Usage: run from the worktree root.
#   bash scripts/worktree-deps.sh [main-checkout]
# The main checkout defaults to the first entry of `git worktree list`.
# WORKTREE_DEPS_NPM overrides the npm binary (tests use a stub).
# WORKTREE_DEPS_PYTHON overrides python3, which makes the clonefile(2) call.
#
# <!-- scope: human-approved task worktree-deps-apfs-clone; this file closes it -->
set -euo pipefail

npm_bin="${WORKTREE_DEPS_NPM:-npm}"
python_bin="${WORKTREE_DEPS_PYTHON:-python3}"
target="$PWD"
stamp="$target/node_modules/.worktree-deps-lock.json"
main="${1:-}"
if [[ -z "$main" ]]; then
  main="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
fi

npm_ci() {
  echo "worktree-deps: $1; running npm ci"
  "$npm_bin" ci
}

# Clone directory $1 to the new path $2 with one clonefile(2) call (macOS only).
clone_tree() {
  "$python_bin" -I -c 'import ctypes, sys
libc = ctypes.CDLL(None, use_errno=True)
sys.exit(1 if libc.clonefile(sys.argv[1].encode(), sys.argv[2].encode(), 0) else 0)' "$1" "$2" 2>/dev/null
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
if [[ -d "$target/node_modules" ]] && cmp -s "$target/package-lock.json" "$stamp"; then
  echo "worktree-deps: node_modules already matches package-lock.json; nothing to do"
  exit 0
fi

# Clone to a temporary name, then move it into place, so an interrupted clone
# never leaves a node_modules with a valid stamp.
tmp="$target/.node_modules.worktree-deps.$$"
rm -rf "$tmp" "$target/node_modules"
if clone_tree "$main/node_modules" "$tmp"; then
  how="clonefile(2)"
else
  rm -rf "$tmp"
  if cp -cR "$main/node_modules" "$tmp" 2>/dev/null; then
    how="cp -cR"
  else
    rm -rf "$tmp"
    npm_ci "copy-on-write clone failed"
    exit 0
  fi
fi
mv "$tmp" "$target/node_modules"
cp "$target/package-lock.json" "$stamp"
echo "worktree-deps: cloned node_modules with $how from $main (lockfiles match)"
