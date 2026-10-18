#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-}"

if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Coverage gate: every hooks/checks/<id>.sh needs a sibling <id>.test.sh.
missing=()
if [[ -d "$repo_root/hooks/checks" ]]; then
  while IFS= read -r script; do
    [[ -n "$script" ]] || continue
    [[ -f "${script%.sh}.test.sh" ]] || missing+=("${script#"$repo_root"/}")
  done < <(/usr/bin/find "$repo_root/hooks/checks" -maxdepth 1 -type f -name '*.sh' ! -name '*.test.sh' | sort)
fi
if ((${#missing[@]} > 0)); then
  echo "Hook fixture coverage: these check scripts have no fixture test:" >&2
  for script in "${missing[@]}"; do
    echo "  ✗ $script (add ${script%.sh}.test.sh)" >&2
  done
  exit 1
fi

fixtures_dir="$repo_root/hooks/checks"
fixtures=""
if [[ -d "$fixtures_dir" ]]; then
  fixtures="$(/usr/bin/find "$fixtures_dir" -maxdepth 1 -type f -name '*.test.sh' | sort)"
fi

if [[ -z "$fixtures" ]]; then
  echo "Hook fixture tests: no fixtures found"
  exit 0
fi

# Keep fixture decisions out of the real ~/.cache/agentbrew log.
fixture_log_dir="$(mktemp -d "${TMPDIR:-/tmp}/hook-fixtures.XXXXXX")"
trap 'rm -rf "$fixture_log_dir"' EXIT
export HOOK_DECISIONS_LOG="$fixture_log_dir/hook-decisions.jsonl"

# Run each fixture the way a stock Mac runs hooks: /bin/bash (3.2 on macOS),
# BSD tools from /usr/bin:/bin, Apple's /usr/bin/jq when present, and an empty
# HOME, so the owner's dotfiles, GNU tools, and newer jq cannot hide a bug.
# A shim dir puts that bash, node, and jq first on PATH. Set
# HOOK_FIXTURES_HOST_ENV=1 to run with your own shell environment instead.
fixture_bash="${HOOK_FIXTURE_BASH:-/bin/bash}"
[[ -x "$fixture_bash" ]] || fixture_bash="$(command -v bash)"
shim_dir="$fixture_log_dir/bin"
fixture_home="$fixture_log_dir/home"
mkdir -p "$shim_dir" "$fixture_home"
ln -s "$fixture_bash" "$shim_dir/bash"
node_bin="$(node -p 'process.execPath' 2>/dev/null || true)"
[[ -z "$node_bin" ]] || ln -s "$node_bin" "$shim_dir/node"
jq_bin="/usr/bin/jq"
[[ -x "$jq_bin" ]] || jq_bin="$(command -v jq || true)"
[[ -z "$jq_bin" ]] || ln -s "$jq_bin" "$shim_dir/jq"

run_fixture() {
  if [[ "${HOOK_FIXTURES_HOST_ENV:-0}" == 1 ]]; then
    bash "$1"
    return
  fi
  env -i HOME="$fixture_home" PATH="$shim_dir:/usr/bin:/bin:/usr/sbin:/sbin" \
    TMPDIR="${TMPDIR:-/tmp}" USER="${USER:-}" LANG="${LANG:-en_US.UTF-8}" \
    HOOK_DECISIONS_LOG="$HOOK_DECISIONS_LOG" "$fixture_bash" "$1"
}

echo "Hook fixture tests ($("$fixture_bash" -c 'echo "bash $BASH_VERSION"')):"
while IFS= read -r fixture; do
  [[ -n "$fixture" ]] || continue
  rel="${fixture#"$repo_root"/}"
  echo "  → $rel"
  run_fixture "$fixture"
  echo "  ✓ $rel"
done <<<"$fixtures"

echo "Hook fixture tests: all passed"
