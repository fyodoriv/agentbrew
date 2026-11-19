#!/bin/bash
set -euo pipefail

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -r -- "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/deployed"
export PATH="$scratch/bin:$PATH"
export HOOK_DECISIONS_LOG="$scratch/decisions.jsonl" GIT_CALL_RECEIPT="$scratch/git-called"

cat > "$scratch/bin/git" <<'STUB'
#!/bin/bash
touch "$GIT_CALL_RECEIPT"
exit 1
STUB
chmod +x "$scratch/bin/git"
cp "$hook_dir/no-destructive-commands.sh" "$scratch/deployed/"
cp -R "$hook_dir/../lib" "$scratch/deployed/lib"
cd "$scratch"

check() {
  local label="$1" expected="$2" tool="$3" command_text="$4" payload result=0
  payload="$(jq -n --arg tool "$tool" --arg command "$command_text" \
    '{hook_event_name:"PreToolUse",tool_name:$tool,tool_input:{command:$command}}')"
  bash "$scratch/deployed/no-destructive-commands.sh" <<<"$payload" >/dev/null 2>&1 || result=$?
  if [ "$result" -ne "$expected" ]; then
    printf '%s: expected exit %s, got %s\n' "$label" "$expected" "$result" >&2
    exit 1
  fi
  printf '%s: exit %s\n' "$label" "$result"
}

check 'drop' 2 Bash 'git stash drop'
check 'clear' 2 Bash 'git stash clear'
check 'path and worktree option' 2 Bash "\"$scratch/bin/git\" -C other-tree stash drop"
check 'Git directory option and quoted subcommand' 2 Bash 'git --git-dir=repo/.git stash "clear"'
check 'quote-joined command words' 2 Bash "git st'ash' cl'ear'"
check 'escaped command words' 2 Bash 'git st\ash dr\op'
check 'hash inside a worktree path' 2 Bash 'git -C tree#branch stash clear'
check 'list' 0 Bash 'git stash list'
check 'show' 0 Bash 'git stash show -p'
check 'save with a discard word in the message' 0 Bash 'git stash push -m "clear details"'
check 'quoted prose' 0 Bash 'printf "%s" "git stash clear"'
check 'another tool' 0 Read 'git stash drop'
check 'separate shell lines' 0 Bash $'git\nstash drop'
check 'no Git subcommand before a comment' 0 Bash $'git # note\nstash drop'
check 'comment instead of a Git directory value' 0 Bash 'git -C # stash drop'
check 'separator instead of a Git directory value' 0 Bash 'git -C; stash drop'
[ ! -e "$GIT_CALL_RECEIPT" ]
printf '%s\n' 'Git commands executed: 0'
