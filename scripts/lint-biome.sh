#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

exec node_modules/.bin/biome check "$@" src scripts real-e2e skill-plugins/*/*/scripts
