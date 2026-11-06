#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]]; then
  cargo="$(node scripts/native-build-tools.mjs cargo)"
  if [[ -n "$cargo" ]]; then
    node scripts/native-build-tools.mjs compile-source
  else
    node scripts/native-build-tools.mjs verify-prebuilt
    printf '%s\n' 'agentbrew: Cargo is unavailable; using the verified source-bound prebuilt native pair.' >&2
  fi
fi
