#!/usr/bin/env bash
set -euo pipefail

# Publish the latest CI-bumped version to npm.
# Run after CI auto-release creates a new version tag on main.
#
# Usage:
#   npm run publish:latest                    # fetch main, build, publish
#   npm run publish:latest -- --quick         # fetch main, publish (skip build — trusts CI)
#   npm run publish:latest -- --dry-run       # preflight + npm publish --dry-run
#   npm run publish:latest -- --otp=123456    # forward any npm publish flags after --
#
# Environment:
#   AGENTBREW_PUBLISH_REMOTE   Git remote (default: origin)
#   AGENTBREW_PUBLISH_BRANCH   Release branch (default: main)

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

publish_remote="${AGENTBREW_PUBLISH_REMOTE:-origin}"
publish_branch="${AGENTBREW_PUBLISH_BRANCH:-main}"
remote_ref="$publish_remote/$publish_branch"

quick=false
npm_publish_args=()
restore_private=false

usage() {
  cat <<'EOF'
Publish the latest CI-bumped agentbrew version to npm.

Usage:
  npm run publish:latest [-- --quick] [-- --dry-run] [-- --otp=XXXXXX]

Options (after npm's --):
  --quick, -q     Skip npm ci/build — trust CI artifacts in dist/
  --dry-run       Run npm publish --dry-run (still runs preflight + build unless --quick)
  --otp=CODE      npm 2FA one-time password (required when publish fails with EOTP)
  (any other flag is forwarded to `npm publish --access public`)

Preflight:
  - npm whoami (login at https://www.npmjs.com/login if missing)
  - git fetch origin/main + tags (worktree-safe — no checkout of main required)
  - syncs package.json, package-lock.json, src/cli.ts from origin/main when behind
  - temporarily strips package.json "private" during publish (restored on exit)

Environment:
  AGENTBREW_PUBLISH_REMOTE   Git remote (default: origin)
  AGENTBREW_PUBLISH_BRANCH   Release branch (default: main)
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

hint_npm_login() {
  cat <<'EOF'

Next step — authenticate with npm:
  npm login
  npm whoami

Registry: https://www.npmjs.com/login
EOF
}

hint_otp() {
  cat <<'EOF'

Next step — retry with your authenticator OTP:
  npm run publish:latest -- --otp=123456

If dist/ is already built from CI:
  npm run publish:latest -- --quick --otp=123456
EOF
}

restore_private_field() {
  if [[ "$restore_private" == true ]]; then
    npm pkg set private=true --json >/dev/null
  fi
}

trap restore_private_field EXIT

for arg in "$@"; do
  case "$arg" in
    --quick | -q)
      quick=true
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      npm_publish_args+=("$arg")
      ;;
  esac
done

preflight_npm_auth() {
  local npm_user
  if ! npm_user="$(npm whoami 2>&1)"; then
    echo "ERROR: npm auth required (ENEEDAUTH)." >&2
    echo "$npm_user" >&2
    hint_npm_login
    exit 1
  fi
  echo "✓ npm authenticated as $npm_user"
}

preflight_git_remote() {
  if ! git remote get-url "$publish_remote" >/dev/null 2>&1; then
    die "Git remote '$publish_remote' not found. Set AGENTBREW_PUBLISH_REMOTE or add the remote."
  fi
}

sync_release_files_from_remote() {
  echo "📦 Fetching $publish_remote/$publish_branch and tags (worktree-safe)..."
  git fetch "$publish_remote" "$publish_branch" --tags

  if ! git rev-parse --verify "$remote_ref" >/dev/null 2>&1; then
    die "Remote branch $remote_ref not found after fetch. Push main to origin first."
  fi

  local local_version remote_version
  local_version="$(node -p "require('./package.json').version")"
  remote_version="$(git show "$remote_ref:package.json" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).version")"

  if [[ "$local_version" != "$remote_version" ]]; then
    echo "↻ Local version v$local_version differs from $remote_ref (v$remote_version) — syncing release files"
    git show "$remote_ref:package.json" > package.json
    git show "$remote_ref:package-lock.json" > package-lock.json
    git show "$remote_ref:src/cli.ts" > src/cli.ts
  else
    echo "✓ Local version matches $remote_ref (v$local_version)"
  fi

  local version tag_ref
  version="$(node -p "require('./package.json').version")"
  tag_ref="v$version"
  if ! git rev-parse --verify "refs/tags/$tag_ref" >/dev/null 2>&1; then
    git fetch "$publish_remote" "refs/tags/$tag_ref:refs/tags/$tag_ref" 2>/dev/null || true
  fi
  if git rev-parse --verify "refs/tags/$tag_ref" >/dev/null 2>&1; then
    echo "✓ Tag $tag_ref present locally"
  else
    echo "⚠ Tag $tag_ref not found locally — continuing (npm registry is authoritative for publish)"
  fi
}

maybe_strip_private_field() {
  if node -e "process.exit(require('./package.json').private ? 0 : 1)"; then
    restore_private=true
    npm pkg delete private >/dev/null
    echo "✓ Temporarily removed package.json private flag for publish"
  fi
}

publish_to_npm() {
  local version="$1"
  echo ""
  echo "🚀 Publishing agentbrew@$version to npm..."
  maybe_strip_private_field

  set +e
  local publish_output
  publish_output="$(npm publish --access public "${npm_publish_args[@]}" 2>&1)"
  local publish_status=$?
  set -e

  if [[ $publish_status -ne 0 ]]; then
    echo "$publish_output" >&2
    if grep -qiE 'one[- ]time password|otp|EOTP|E401.*otp' <<<"$publish_output"; then
      hint_otp
    fi
    exit "$publish_status"
  fi

  echo "$publish_output"
}

echo "🔍 Preflight..."
preflight_npm_auth
preflight_git_remote
sync_release_files_from_remote

version="$(node -p "require('./package.json').version")"
echo "📌 Version: $version"

published="$(npm view agentbrew version 2>/dev/null || echo "0.0.0")"
if [[ "$version" == "$published" ]]; then
  echo "✅ v$version already published on npm. Nothing to do."
  exit 0
fi

if [[ "$quick" == true ]]; then
  echo "⚡ Quick mode — skipping build (trusting CI)"
else
  echo "🔨 Building..."
  npm ci
  npm run build
fi

test -f dist/cli.js || die "dist/cli.js missing — run without --quick or build first"
dist_version="$(node dist/cli.js --version)"
[[ "$dist_version" == "$version" ]] || die "Version mismatch: dist=$dist_version, package=$version"

publish_to_npm "$version"

echo ""
echo "✅ Published agentbrew@$version"
echo "   npm: https://www.npmjs.com/package/agentbrew"
echo "   npx: npx agentbrew@$version --version"
