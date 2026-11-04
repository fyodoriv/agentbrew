#!/bin/bash
set -euo pipefail

# The install, repair and source refresh all use this npm build entry.
unset AGENTBREW_BUILD_OUT_DIR
host="$(uname -s)-$(uname -m)"
if [[ "$host" == Linux-x86_64 || "$host" == Linux-aarch64 ]]; then
  cargo build --locked --release --manifest-path rust/judge-source/Cargo.toml \
    --target-dir rust/judge-source/target
fi
if [[ "$host" != Darwin-arm64 ]]; then
  tsup
  exec bash scripts/build-pipeline-guard.sh --dist-only
fi

repo="$(pwd -P)"
cargo build --locked --release --manifest-path rust/judge-source/Cargo.toml \
  --target aarch64-apple-darwin --target-dir rust/judge-source/target
publisher="$repo/rust/checkup-run/target/aarch64-apple-darwin/release/publish-dist"
repo_identity="$(stat -f '%d:%i' "$repo")"
head="$(git rev-parse --verify HEAD 2>/dev/null || true)"
previous=absent
if [[ -e "$repo/dist" || -L "$repo/dist" ]]; then
  previous="$(stat -f '%d:%i' "$repo/dist")"
fi
directory_identity() {
  if [[ -e "$1" || -L "$1" ]]; then
    [[ -d "$1" && ! -L "$1" ]] || return 1
    stat -f '%d:%i' "$1"
  else
    printf '%s\n' absent
  fi
}

stage="$(mktemp -d "$repo/.agentbrew-build.XXXXXXXX")"
stage_identity="$(directory_identity "$stage")"
cleanup_dist=absent

# Refuse to traverse an ambiguous stage. Once checked, use relative names in
# the stage directory so a later rename of the stage path cannot redirect rm.
cleanup() {
  if ! (
    [[ "$(directory_identity "$stage")" == "$stage_identity" ]] &&
      cd -P -- "$stage" &&
      [[ "$(directory_identity .)" == "$stage_identity" ]] &&
      [[ "$(directory_identity ./dist)" == "$cleanup_dist" ]] &&
      rm -rf -- ./dist ./state ./package.json
  ); then
    printf '%s\n' 'agentbrew: retained an unverified build stage' >&2
    return
  fi
  if [[ "$(directory_identity "$stage")" == "$stage_identity" ]]; then
    rmdir -- "$stage" || true
  fi
}
trap cleanup EXIT
AGENTBREW_BUILD_OUT_DIR="$stage/dist" tsup
candidate_identity="$(directory_identity "$stage/dist")"
cleanup_dist="$candidate_identity"
# The bundled CLI reads its version from the package root above dist/.
cp "$repo/package.json" "$stage/package.json"
mkdir -m 700 "$stage/state"
XDG_STATE_HOME="$stage/state" node "$stage/dist/cli.js" checkup-run show fixture --json >/dev/null
bash scripts/build-pipeline-guard.sh --dist-only "$stage/dist"
"$publisher" "$repo" "${stage##*/}" "$previous" "$head" \
  "$repo_identity" "$stage_identity" "$candidate_identity"
cleanup_dist="$previous"
