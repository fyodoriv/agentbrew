#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Public-release destination is parameterised. Override AGENTBREW_PUBLIC_ORG
# or AGENTBREW_PUBLIC_REPO before invoking to validate a different repo.
public_org="${AGENTBREW_PUBLIC_ORG:-fyodoriv}"
public_repo_name="${AGENTBREW_PUBLIC_REPO:-agentbrew}"
public_slug="$public_org/$public_repo_name"
validation_mode="strict-publish"

usage() {
  cat <<'EOF'
Usage: scripts/validate-public-mirror.sh [--strict-publish]

  --strict-publish  Validate package metadata and the scrubbed public-publish
                    surface (the default).
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --strict-publish) validation_mode="strict-publish" ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

expected_repo="https://github.com/$public_slug"
expected_homepage="https://github.com/$public_slug#readme"
expected_bugs="https://github.com/$public_slug/issues"

actual_repo="$(node -p "require('$repo_root/package.json').repository.url")"
actual_homepage="$(node -p "require('$repo_root/package.json').homepage")"
actual_bugs="$(node -p "require('$repo_root/package.json').bugs")"

if [[ "$actual_repo" != "$expected_repo" ]]; then
  echo "ERROR: repository.url is '$actual_repo' (expected '$expected_repo')"
  exit 1
fi

if [[ "$actual_homepage" != "$expected_homepage" ]]; then
  echo "ERROR: homepage is '$actual_homepage' (expected '$expected_homepage')"
  exit 1
fi

if [[ "$actual_bugs" != "$expected_bugs" ]]; then
  echo "ERROR: bugs is '$actual_bugs' (expected '$expected_bugs')"
  exit 1
fi

echo "✓ package metadata points to the public GitHub repo"

# Scrub pattern: any GHE host (github.<word>.<tld>) other than github.com,
# typical internal org prefixes, and JIRA-style ticket keys.
scrub_pattern="${AGENTBREW_PUBLIC_SCRUB_PATTERN:-github\\.[a-z0-9-]+\\.[a-z]+|\\b[A-Z][A-Z0-9]+-[0-9]+\\b}"
if grep -nE "$scrub_pattern" \
  "$repo_root/README.md" \
  "$repo_root/SECURITY.md" \
  "$repo_root/CODE_OF_CONDUCT.md" \
  "$repo_root/scripts/release.sh" \
  "$repo_root/scripts/publish-latest.sh" \
  "$repo_root/package.json"; then
  echo "ERROR: public publish surface still contains internal URLs or ticket keys"
  exit 1
fi

echo "✓ publish surface scrub checks passed"

npm --prefix "$repo_root" pack --dry-run >/dev/null

echo "✓ npm pack dry run passed"
