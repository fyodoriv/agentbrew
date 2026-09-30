#!/usr/bin/env bash
set -euo pipefail

# Release script for agentbrew
# Usage: npm run release [patch|minor|major]
#
# Steps:
#   1. Verify clean working tree
#   2. Typecheck + test + build
#   3. Verify dist output
#   4. Bump version in package.json + src/cli.ts
#   5. Commit, tag, push
#   6. Create GitHub release (if gh CLI available)
#   7. Publish to npm (prompts for OTP)

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: npm run release [patch|minor|major]"
  exit 1
fi

# 1. Clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Working tree not clean. Commit or stash changes first."
  exit 1
fi

echo "📋 Release type: $BUMP"

# 2. Typecheck + test + build
echo "🔍 Typechecking..."
npm run typecheck

echo "🧪 Testing..."
npm test

echo "🔨 Building..."
npm run build

# 3. Verify dist
if [[ ! -f dist/cli.js ]]; then
  echo "❌ dist/cli.js missing"
  exit 1
fi
if ! head -1 dist/cli.js | grep -q '#!/usr/bin/env node'; then
  echo "❌ Missing shebang in dist/cli.js"
  exit 1
fi

OLD_VERSION=$(node -p "require('./package.json').version")
echo "📌 Current version: $OLD_VERSION"

# 4. Bump version
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

# Update version in src/cli.ts (use sed -i.bak for cross-platform macOS/Linux compat)
sed -i.bak "s/.version(\"$OLD_VERSION\")/.version(\"$NEW_VERSION\")/" src/cli.ts && rm -f src/cli.ts.bak

echo "📦 New version: $NEW_VERSION"

# Rebuild with new version
npm run build

# Verify version in dist
DIST_VERSION=$(node dist/cli.js --version)
if [[ "$DIST_VERSION" != "$NEW_VERSION" ]]; then
  echo "❌ Version mismatch: dist says $DIST_VERSION, expected $NEW_VERSION"
  exit 1
fi

# 5. Commit + tag + push
git add package.json package-lock.json src/cli.ts
git commit -m "chore: release v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push && git push --tags

echo "✅ Pushed v$NEW_VERSION"

# 6. GitHub release (if gh available)
if command -v gh &>/dev/null; then
  echo "📝 Creating GitHub release..."
  gh release create "v$NEW_VERSION" \
    --title "v$NEW_VERSION" \
    --generate-notes \
    2>/dev/null || echo "⚠️  GitHub release creation failed (enterprise GitHub may not support it)"
else
  echo "💡 Install gh CLI to auto-create GitHub releases: brew install gh"
fi

# 7. Publish to npm
echo ""
echo "🚀 Publishing to npm..."
npm publish --access public

echo ""
echo "✅ Released agentbrew@$NEW_VERSION"
echo "   npm: https://www.npmjs.com/package/agentbrew"
echo "   npx: npx agentbrew@$NEW_VERSION --version"
