#!/usr/bin/env bash
# One-line setup: install everything, then prove the machine is ready.
# Safe to run again; each step skips work that is already done.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$1"; }

step "Install dependencies"
if [ "${SETUP_SKIP_DEPS:-0}" = 1 ]; then
  echo "skipped (SETUP_SKIP_DEPS=1)"
else
  if [ -f package.json ]; then
    if [ -f pnpm-lock.yaml ] || grep -q '"packageManager": *"pnpm' package.json; then
      corepack enable >/dev/null 2>&1 || true
      pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    else
      npm ci 2>/dev/null || npm install
    fi
  fi
  if [ -f pyproject.toml ]; then uv sync; fi
  if [ -f Cargo.toml ]; then cargo fetch; fi
fi

step "Create local folders (never committed)"
mkdir -p .metrics
{{SETUP_EXTRA}}
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env && echo "created .env from .env.example"; } || true

step "Install git hooks"
if [ -f lefthook.yml ] && command -v lefthook >/dev/null 2>&1; then
  lefthook install >/dev/null 2>&1 || echo "note: lefthook install skipped (a global core.hooksPath may own the hooks)"
fi

step "Health check"
scripts/doctor.sh

printf '\nReady. Next: scripts/check.sh\n'
