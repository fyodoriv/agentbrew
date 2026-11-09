#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]]; then
  cargo="$(node scripts/native-build-tools.mjs cargo)"
  if [[ -n "$cargo" ]]; then
    if node scripts/native-build-tools.mjs compile-source; then
      :
    else
      status=$?
      if [[ "$status" -ne 65 ]]; then
        exit "$status"
      fi
      node scripts/native-build-tools.mjs use-prebuilt
      printf '%s\n' 'agentbrew: the native helper failed to compile or link; using the verified prebuilt pair. The SDK may be unreadable by this linker; set SDKROOT to a compatible SDK to rebuild natively.' >&2
    fi
  else
    node scripts/native-build-tools.mjs verify-prebuilt
    printf '%s\n' 'agentbrew: Cargo is unavailable; using the verified source-bound prebuilt native pair.' >&2
  fi
fi
