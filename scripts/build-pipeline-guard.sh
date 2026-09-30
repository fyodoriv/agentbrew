#!/usr/bin/env bash

set -euo pipefail

repo_root="${AGENTBREW_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
mode="${1:---full}"
remediation="deps out of sync — run npm ci"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

check_deps() {
  if [[ ! -f "$repo_root/package.json" || ! -f "$repo_root/package-lock.json" ]]; then
    printf 'Build pipeline guard: package lockfile absent, skipping dependency drift check\n'
    return
  fi

  if [[ ! -d "$repo_root/node_modules" ]]; then
    fail "$remediation: node_modules is missing"
  fi

  local npm_output
  if ! npm_output="$(npm --prefix "$repo_root" ls --depth=0 --json --loglevel=error 2>&1)"; then
    printf '%s\n' "$npm_output" >&2
    fail "$remediation: npm ls reported package-lock/node_modules drift"
  fi

  printf 'Build pipeline guard: npm dependencies match package-lock.json\n'
}

check_dist() {
  local cli_path="$repo_root/dist/cli.js"

  if [[ ! -f "$cli_path" ]]; then
    fail "dist/cli.js missing — run npm run build"
  fi

  local version_output
  if ! version_output="$(node "$cli_path" --version 2>&1)"; then
    printf '%s\n' "$version_output" >&2
    fail "dist/cli.js is not runnable with --version"
  fi

  if [[ -z "${version_output//[[:space:]]/}" ]]; then
    fail "dist/cli.js --version produced no output"
  fi

  printf 'Build pipeline guard: dist/cli.js --version printed %s\n' "$version_output"
}

case "$mode" in
  --deps-only)
    check_deps
    ;;
  --dist-only)
    check_dist
    ;;
  --full)
    check_deps
    npm --prefix "$repo_root" run build
    ;;
  *)
    fail "unknown mode '$mode' (expected --deps-only, --dist-only, or --full)"
    ;;
esac
