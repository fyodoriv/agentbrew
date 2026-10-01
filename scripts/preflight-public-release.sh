#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

# Public-release destination is parameterised so this preflight is reusable
# across orgs publishing their agentbrew fork. Set AGENTBREW_PUBLIC_ORG and
# (optionally) AGENTBREW_PUBLIC_REPO before invoking. Defaults below are
# placeholders so unconfigured runs fail loudly rather than silently.
public_org="${AGENTBREW_PUBLIC_ORG:-<your-public-org>}"
public_repo="${AGENTBREW_PUBLIC_REPO:-agentbrew}"
public_slug="$public_org/$public_repo"

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    echo "✓ Found $command_name"
    return
  fi

  echo "ERROR: Missing required command '$command_name'. $install_hint"
  failures=1
}

check_github_auth() {
  if gh auth status -h github.com >/dev/null 2>&1; then
    echo "✓ GitHub CLI is authenticated for github.com"
    return
  fi

  echo "ERROR: GitHub CLI is not authenticated for github.com. Run 'gh auth login -h github.com'."
  failures=1
}

check_public_repo_access() {
  local access_json
  local permission_summary
  local viewer_is_a_member
  local viewer_can_create_repositories
  local repo_exists

  if ! access_json="$(bash "$repo_root/scripts/check-public-repo-access.sh" --json "$public_org" "$public_repo")"; then
    echo "ERROR: Unable to inspect public destination repo access."
    failures=1
    return
  fi

  permission_summary="$(
    ACCESS_JSON="$access_json" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["ACCESS_JSON"])
print(
    f"{str(payload.get('viewerIsAMember', False)).lower()} "
    f"{str(payload.get('viewerCanCreateRepositories', False)).lower()} "
    f"{str(payload.get('repoExists', False)).lower()}"
)
PY
  )"

  read -r viewer_is_a_member viewer_can_create_repositories repo_exists <<<"$permission_summary"

  if [[ "$repo_exists" == "true" ]]; then
    echo "✓ Public destination repo exists: github.com/$public_slug"
    return
  fi

  echo "ERROR: Public destination repo github.com/$public_slug is missing or inaccessible."
  echo "viewerIsAMember: $viewer_is_a_member"
  echo "viewerCanCreateRepositories: $viewer_can_create_repositories"
  echo "repoExists: $repo_exists"
  echo "Create the public repo, then rerun this preflight."
  echo "Suggested command: gh repo create \"$public_slug\" --public"
  failures=1
}

check_npm_auth() {
  if npm whoami >/dev/null 2>&1; then
    echo "✓ npm publish credentials are configured"
    return
  fi

  echo "ERROR: npm publish credentials are missing. Run 'npm login' for the account that will publish agentbrew."
  failures=1
}

main() {
  require_command "git" "Install Git before running the public release cutover."
  require_command "gh" "Install GitHub CLI: https://cli.github.com/"
  require_command "npm" "Install Node.js 20.11+ and npm."

  if git filter-repo --help >/dev/null 2>&1; then
    echo "✓ git filter-repo is installed"
  else
    echo "ERROR: git filter-repo is not installed. See https://github.com/newren/git-filter-repo."
    failures=1
  fi

  check_github_auth
  check_public_repo_access
  check_npm_auth

  if [[ -x "$repo_root/scripts/validate-public-release.sh" ]]; then
    echo "✓ Public release validator is present: scripts/validate-public-release.sh"
    echo "  Run the strict publish scrub before release: scripts/validate-public-release.sh --strict-publish"
  else
    echo "ERROR: scripts/validate-public-release.sh is missing or not executable."
    failures=1
  fi

  if [[ "$failures" -ne 0 ]]; then
    echo
    echo "Public release preflight failed. Resolve the errors above, then rerun this script."
    exit 1
  fi

  echo
  echo "Public release preflight passed."
}

main "$@"
