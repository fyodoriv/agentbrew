#!/bin/bash
set -euo pipefail

hook="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/judge-draft-save.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
unset DOTFILES_DIR DOTFILES_JQ
export HOME="$scratch"
export CAPTURE="$scratch/draft.json"
export PATH="$scratch:$PATH"
export AGENTBREW_JUDGE_DRAFT_TOOL=mcp__fixture__draft_save
export AGENTBREW_JUDGE_DRAFT_FIELD=text

cat > "$scratch/agentbrew" <<'STUB'
#!/bin/bash
set -eu
[ "$*" = 'judge gate-draft' ]
cat > "$CAPTURE"
jq -e '. == "Fixture draft.\n"' "$CAPTURE" >/dev/null
STUB
chmod +x "$scratch/agentbrew"

printf '%s' '{"tool_name":"mcp__fixture__other","tool_input":{"text":"Other"}}' | bash "$hook"
[ ! -e "$CAPTURE" ]

printf '%s' '{"tool_name":"mcp__fixture__draft_save","tool_input":{"text":"Fixture draft.\n"}}' | bash "$hook"
jq -e '. == "Fixture draft.\n"' "$CAPTURE" >/dev/null

for input in '{"text":"Fixture draft."}' '{}'; do
  result=0
  printf '{"tool_name":"mcp__fixture__draft_save","tool_input":%s}' "$input" | bash "$hook" 2>"$scratch/error" || result=$?
  [ "$result" -eq 2 ]
done
printf '%s\n' 'judge-draft-save: 4 passed'
