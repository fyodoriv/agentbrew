#!/bin/bash
set -euo pipefail

hook="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/judge-report-final.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
unset DOTFILES_DIR DOTFILES_JQ
export HOME="$scratch"
export CAPTURE="$scratch/message.json"
export PATH="$scratch:$PATH"

cat > "$scratch/agentbrew" <<'STUB'
#!/bin/bash
set -eu
[ "$*" = 'judge gate-report' ]
cat > "$CAPTURE"
exit "${GATE_STATUS:-0}"
STUB
chmod +x "$scratch/agentbrew"

payload='{"last_assistant_message":"A report.\r\n\n"}'
output="$(printf '%s' "$payload" | bash "$hook")"
[ -z "$output" ]
jq -e '. == "A report.\r\n\n"' "$CAPTURE" >/dev/null

output="$(printf '%s' "$payload" | GATE_STATUS=2 bash "$hook")"
jq -e '.systemMessage | contains("no verified fresh")' <<<"$output" >/dev/null

rm "$CAPTURE"
output="$(printf '%s' '{"last_assistant_message":null}' | bash "$hook")"
[ -z "$output" ] && [ ! -e "$CAPTURE" ]
printf '%s\n' 'judge-report-final: 3 passed'
