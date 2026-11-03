#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]]; then
  cargo build --locked --release --manifest-path rust/checkup-run/Cargo.toml \
    --target aarch64-apple-darwin --target-dir rust/checkup-run/target
fi
