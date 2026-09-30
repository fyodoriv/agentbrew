#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-}"

if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [[ ! -d "$repo_root" ]]; then
  echo "ERROR: repo root does not exist: $repo_root" >&2
  exit 1
fi

# Use /usr/bin/find explicitly — the dotfiles repo ships a `bin/find`
# shim that redirects `find` to `fd` (faster, respects .gitignore), and
# that shim is on PATH ahead of /usr/bin on most agentbrew dev machines.
# GNU find's `-maxdepth -type -name -exec` syntax doesn't translate to
# fd, so the shim makes this script fail with "unexpected argument '-m'"
# whenever the dotfiles shim is active. /usr/bin/find is the real binary
# on every macOS install and on most Linux distros; falling back to the
# shim breaks this script's syntax model.
artifact_names="$(
  /usr/bin/find "$repo_root" -maxdepth 1 -type f -name '=*' -exec basename {} \; | sort
)"

if [[ -n "$artifact_names" ]]; then
  echo "ERROR: repo-root version-constraint artifacts found:" >&2
  printf "%s\n" "$artifact_names" | sed 's/^/  /' >&2
  echo "" >&2
  echo "These files usually come from unquoted shell package constraints," >&2
  echo "for example: pip install package>=1.2.3" >&2
  echo "Quote constraints so '>' is not parsed as redirection:" >&2
  echo "  pip install 'package>=1.2.3'" >&2
  exit 1
fi

echo "Repo artifact lint: no root =... files"
