#!/usr/bin/env bash

set -euo pipefail

output_format="text"
positional_args=()

for argument in "$@"; do
  case "$argument" in
    --json)
      output_format="json"
      ;;
    *)
      positional_args+=("$argument")
      ;;
  esac
done

org="${positional_args[0]:-${AGENTBREW_PUBLIC_ORG:-}}"
if [ -z "$org" ]; then
  echo "ERROR: org positional arg or AGENTBREW_PUBLIC_ORG env var required" >&2
  exit 1
fi
repo="${positional_args[1]:-agentbrew}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated." >&2
  exit 1
fi

graphql_query='
query RepoCreatePermission($owner: String!) {
  repositoryOwner(login: $owner) {
    login
    ... on Organization {
      viewerCanCreateRepositories
    }
  }
}'

permission_json="$(
  gh api graphql \
    -f query="$graphql_query" \
    -F owner="$org"
)"

permission_fields="$(
  printf "%s" "$permission_json" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
owner = payload.get("data", {}).get("repositoryOwner")
viewer_is_a_member = owner is not None
viewer_can_create_repositories = False

if isinstance(owner, dict):
    viewer_can_create_repositories = bool(owner.get("viewerCanCreateRepositories", False))

print(f"{str(viewer_is_a_member).lower()} {str(viewer_can_create_repositories).lower()}")
'
)"

read -r is_member can_create_repo <<<"$permission_fields"

repo_exists="false"
repo_url=""

if repo_json="$(gh repo view "$org/$repo" --json url,visibility,defaultBranchRef 2>/dev/null)"; then
  repo_url="$(
    printf "%s" "$repo_json" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
print(payload["url"])
'
  )"
  repo_exists="true"
fi

if [[ "$output_format" == "json" ]]; then
  python3 - "$org" "$repo" "$is_member" "$can_create_repo" "$repo_exists" "$repo_url" <<'PY'
import json
import sys

org, repo, is_member, can_create_repo, repo_exists, repo_url = sys.argv[1:]
print(json.dumps({
    "org": org,
    "repo": repo,
    "viewerIsAMember": is_member == "true",
    "viewerCanCreateRepositories": can_create_repo == "true",
    "repoExists": repo_exists == "true",
    "repoUrl": repo_url or None,
}, indent=2))
PY
  exit 0
fi

echo "GitHub org: $org"
echo "Target repo: $org/$repo"
echo "viewerIsAMember: $is_member"
echo "viewerCanCreateRepositories: $can_create_repo"
echo "repoExists: $repo_exists"

if [[ -n "$repo_url" ]]; then
  echo "repoUrl: $repo_url"
fi

if [[ "$can_create_repo" != "true" ]]; then
  echo
  echo "Next step: request or renew temporary repo-creation access in the $org org"
  echo "before retrying \`gh repo create\` or the transfer API."
fi
