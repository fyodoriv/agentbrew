#!/bin/bash
set -euo pipefail

hook="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/judge-pr-delivery.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
unset DOTFILES_DIR DOTFILES_JQ
export HOME="$scratch"
export CAPTURE="$scratch/argv.json"
export PATH="$scratch:$PATH"

cat > "$scratch/agentbrew" <<'STUB'
#!/bin/bash
set -eu
[ "$1" = judge ] && [ "$2" = gate-pr ]
cat > "$CAPTURE"
printf '%s' "$3" > "$CAPTURE.event"
printf '%s\n' "$3" >> "$CAPTURE.calls"
[ "${DENY_EVENT:-}" != "$3" ] || exit 2
exit "${GATE_STATUS:-0}"
STUB
chmod +x "$scratch/agentbrew"

invoke() {
  local command="$1"
  printf '%s' "$command" | jq -Rsc --arg cwd "$scratch" \
    '{tool_name:"Bash",tool_input:{command:.},cwd:$cwd}' | bash "$hook"
}

invoke "gh pr create --title 'A title' --body 'Exact body.'"
jq -e '. == ["gh","pr","create","--title","A title","--body","Exact body."]' "$CAPTURE" >/dev/null
[ "$(cat "$CAPTURE.event")" = pr-create ]

status=0
GATE_STATUS=2 invoke "gh pr ready 42" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]
[ "$(cat "$CAPTURE.event")" = pr-ready ]

rm "$CAPTURE"
invoke "echo 'gh pr create'"
[ ! -e "$CAPTURE" ]

invoke "cd other && gh pr create --fill"
jq -e '. == []' "$CAPTURE" >/dev/null

rm "$CAPTURE.calls"
status=0
DENY_EVENT=pr-ready invoke "gh pr create --fill; gh pr ready 42" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]
[ "$(cat "$CAPTURE.calls")" = "$(printf 'pr-create\npr-ready')" ]

for command in "gh 'pr' create --title T --body Draft" "gh pr 'create' --title T --body Draft"; do
  status=0
  GATE_STATUS=2 invoke "$command" >"$scratch/out" 2>"$scratch/err" || status=$?
  [ "$status" -eq 2 ]
done
status=0
DENY_EVENT=pr-ready invoke "gh pr create --fill; gh 'pr' ready 42" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]

padding="$(printf '%262144s' '')"
status=0
invoke "gh pr ready 42${padding}; gh pr ready 43" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]
status=0
DENY_EVENT=pr-ready invoke "gh pr create --fill; GH_PROMPT_DISABLED=1 gh 'pr' ready 42" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]

for command in "echo ';' gh 'pr' ready 42" 'echo "text; gh pr ready 42"'; do
  CAPTURE="$CAPTURE.bypass" invoke "$command"
  [ ! -e "$CAPTURE.bypass" ]
done
status=0
DENY_EVENT=pr-ready invoke "printf '%s\n' x\ #literal; gh 'pr' ready 42" >"$scratch/out" 2>"$scratch/err" || status=$?
[ "$status" -eq 2 ]
printf '%s\n' 'judge-pr-delivery: 13 passed'
