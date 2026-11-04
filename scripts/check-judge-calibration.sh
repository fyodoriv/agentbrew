#!/bin/bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/agentbrew-judge-ci.XXXXXXXX")"
scratch="$(cd "$scratch" && pwd -P)"
trap 'rm -r -- "$scratch"' EXIT

export HOME="$scratch/home"
export AGENTBREW_NO_AUTO_SYNC=1
export AGENTBREW_NO_SHELL_HOOK=1
export AGENTBREW_PROMPTFOO_PACKAGE="$repo/node_modules/promptfoo"
mkdir -p "$HOME/.claude" "$scratch/fixture/docs/examples/judges"
cp -R "$repo/docs/examples/judges/." "$scratch/fixture/docs/examples/judges/"
printf '%s\n' 'judges: [docs/examples/judges/clarity.md]' > "$scratch/fixture/Agentfile.yaml"

cli=("$repo/dist/cli.js")
node "${cli[@]}" init --skip-install --skip-sync
node "${cli[@]}" sync --agentfile "$scratch/fixture/Agentfile.yaml" --only agents
node "${cli[@]}" judge eval clarity
