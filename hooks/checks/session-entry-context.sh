#!/bin/bash
set -euo pipefail

hook_dir="${BASH_SOURCE[0]%/*}"
[[ "${BASH_SOURCE[0]}" == */* ]] || hook_dir=.
hook_dir="$(CDPATH='' cd -- "$hook_dir" && pwd)"
if [ -d "$hook_dir/lib" ]; then lib="$hook_dir/lib"; else lib="$hook_dir/../lib"; fi
exec /usr/bin/env -i HOME="${HOME:-}" PATH=/usr/bin:/bin /usr/bin/perl "$lib/session-entry-context.pl"
