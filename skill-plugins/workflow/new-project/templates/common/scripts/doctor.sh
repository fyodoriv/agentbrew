#!/usr/bin/env bash
# Health check. One line per check: "ok", or "FAIL" plus the exact fix.
# Exit 0 only when every check passes. Content-free: never prints user data.
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
ok() { echo "ok    $1"; }
fail() { echo "FAIL  $1 -> fix: $2"; fails=$((fails + 1)); }
need() { if command -v "$1" >/dev/null 2>&1; then ok "$1 installed"; else fail "$1 missing" "$2"; fi; }

need git "install git"
[ -f package.json ] && need node "mise use node@lts"
[ -f pnpm-lock.yaml ] && need pnpm "corepack enable"
[ -f pyproject.toml ] && need uv "curl -LsSf https://astral.sh/uv/install.sh | sh"
[ -f Cargo.toml ] && need cargo "curl https://sh.rustup.rs -sSf | sh"

if [ -f .env.example ]; then
  for key in $(grep -E '^[A-Z][A-Z0-9_]*=.*# required' .env.example | cut -d= -f1); do
    if grep -qE "^$key=.+" .env 2>/dev/null || [ -n "${!key:-}" ]; then ok "env $key set"
    else fail "env $key empty" "set it in .env (see .env.example)"; fi
  done
fi
[ -d .metrics ] && ok ".metrics/ exists" || fail ".metrics/ missing" "scripts/setup.sh"
{{DOCTOR_EXTRA}}
# FILL: add one check per thing that breaks the main user story (a model reachable, a port free, a file readable).

[ "$fails" -eq 0 ] && echo "doctor: all checks passed" || echo "doctor: $fails check(s) failed"
[ "$fails" -eq 0 ]
