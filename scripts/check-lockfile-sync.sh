#!/usr/bin/env bash
# Fail when package.json and package-lock.json disagree, the way npm 10 sees it.
#
# Why npm 10: newer npm (11, 12) accepts some out-of-sync lockfiles that npm 10
# rejects. A missing nested entry ("Missing: gcp-metadata@7.0.1 from lock
# file") passed on npm 12 but broke `npm ci` and `install.sh run` for every
# npm 10 user. So this check runs `npm ci --dry-run` with npm 10.
#
# It copies package.json, package-lock.json, and any `file:` dependency into a
# temp dir and runs there, so the real node_modules is never touched.
# npm 10 comes from the npx cache when present (--prefer-offline). With no
# network and no cache, it fails fast with a clear message, never a hang.
#
# Usage: bash scripts/check-lockfile-sync.sh   (from the repo root)
# Env:   LOCKFILE_SYNC_NPX      npx binary (tests use a stub); default npx
#        LOCKFILE_SYNC_NPM      npm spec to check with; default npm@10
#        LOCKFILE_SYNC_TIMEOUT  seconds before the check gives up; default 180
# Exit:  0 in sync, 1 out of sync, 2 npm could not run (network, timeout).
# Runs under macOS /bin/bash 3.2.
# <!-- scope: human-approved task main-stays-installable (TASKS.md); this file closes it -->
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 2
npx_bin="${LOCKFILE_SYNC_NPX:-npx}"
npm_spec="${LOCKFILE_SYNC_NPM:-npm@10}"
limit="${LOCKFILE_SYNC_TIMEOUT:-180}"

if [ ! -f package.json ] || [ ! -f package-lock.json ]; then
  echo "lockfile-sync: package.json or package-lock.json is missing" >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/lockfile-sync.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp package.json package-lock.json "$work/"
# Local `file:` dependencies must exist for npm to resolve the tree.
node -e '
  const p = require("./package.json");
  const all = { ...p.dependencies, ...p.devDependencies, ...p.optionalDependencies };
  for (const v of Object.values(all)) if (typeof v === "string" && v.startsWith("file:")) console.log(v.slice(5));
' | while IFS= read -r dir; do
  mkdir -p "$work/$(dirname "$dir")"
  cp -R "$dir" "$work/$dir"
done

log="$work/npm.log"
# Fail fast offline: one retry, a short fetch timeout, and a hard wall clock.
# The clock kills the whole npx process group and exits 142.
with_timeout() {
  perl -e '
    my $t = shift;
    my $pid = fork() // exit 127;
    if (!$pid) { setpgrp(0, 0); exec(@ARGV) or exit 127 }
    $SIG{ALRM} = sub { kill("TERM", -$pid); waitpid($pid, 0); exit 142 };
    alarm $t;
    waitpid($pid, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@"
}
(
  cd "$work" &&
    npm_config_fetch_retries=1 npm_config_fetch_timeout=20000 npm_config_update_notifier=false \
      with_timeout "$limit" "$npx_bin" --yes --prefer-offline --package="$npm_spec" -- \
      npm ci --dry-run --ignore-scripts --no-audit --no-fund
) >"$log" 2>&1
rc=$?

if [ "$rc" = 0 ]; then
  echo "lockfile-sync: ok (package.json and package-lock.json agree for $npm_spec)"
  exit 0
fi
if grep -qE 'in sync|Missing: |Invalid: ' "$log"; then
  echo "lockfile-sync: package.json and package-lock.json are out of sync for $npm_spec." >&2
  grep -E 'Missing: |Invalid: ' "$log" | sed 's/^npm error /  /' | head -20 >&2
  echo "Fix: run 'npx --yes --package=$npm_spec -- npm install --ignore-scripts' and commit package-lock.json." >&2
  exit 1
fi
if [ "$rc" = 142 ]; then
  echo "lockfile-sync: gave up after ${limit}s; could not run $npm_spec. Check the network and re-run." >&2
  exit 2
fi
if grep -qiE 'ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|network|request to .* failed' "$log"; then
  echo "lockfile-sync: could not fetch $npm_spec (network down?). Connect once so npx caches it, then re-run." >&2
  exit 2
fi
echo "lockfile-sync: $npm_spec ci --dry-run failed (rc=$rc):" >&2
tail -20 "$log" >&2
exit 2
