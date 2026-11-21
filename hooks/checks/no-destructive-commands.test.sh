#!/bin/bash
set -euo pipefail

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scratch="$(mktemp -d)"
trap '/bin/rm -r -- "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/deployed"
export PATH="$scratch/bin:$PATH"
export HOOK_DECISIONS_LOG="$scratch/decisions.jsonl" GIT_CALL_RECEIPT="$scratch/git-called" GH_CALL_RECEIPT="$scratch/gh-called" NPM_CALL_RECEIPT="$scratch/npm-called"
export RM_CALL_RECEIPT="$scratch/rm-called"

cat > "$scratch/bin/git" <<'STUB'
#!/bin/bash
touch "$GIT_CALL_RECEIPT"
exit 1
STUB
cat > "$scratch/bin/gh" <<'STUB'
#!/bin/bash
touch "$GH_CALL_RECEIPT"
exit 1
STUB
cat > "$scratch/bin/npm" <<'STUB'
#!/bin/bash
touch "$NPM_CALL_RECEIPT"
exit 1
STUB
cat > "$scratch/bin/rm" <<'STUB'
#!/bin/bash
: > "$RM_CALL_RECEIPT"
exit 1
STUB
chmod +x "$scratch/bin/git" "$scratch/bin/gh" "$scratch/bin/npm" "$scratch/bin/rm"
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
    return 1
  fi
  printf '%s: exit %s\n' "$label" "$result"
}

check_github() {
  local failed=0
  check 'delete repository' 2 Bash 'gh repo delete example/project --yes' || failed=1
  check 'delete current repository' 2 Bash 'gh repo delete' || failed=1
  check 'quoted delete with path' 2 Bash "\"$scratch/bin/gh\" re'po' de'lete'" || failed=1
  check 'admin merge after PR number' 2 Bash 'gh pr merge 123 --admin' || failed=1
  check 'explicit admin merge' 2 Bash 'gh pr merge --admin=true 123' || failed=1
  check 'admin merge with another repository' 2 Bash 'gh pr merge -R example/project --admin 123' || failed=1
  check 'escape-joined admin flag' 2 Bash 'gh pr merge 123 --ad\min' || failed=1
  check 'repository view' 0 Bash 'gh repo view example/project' || failed=1
  check 'deletion words in list option' 0 Bash 'gh repo list --topic "gh repo delete"' || failed=1
  check 'ordinary squash' 0 Bash 'gh pr merge 123 --squash' || failed=1
  check 'explicit non-admin merge' 0 Bash 'gh pr merge 123 --admin=false' || failed=1
  check 'administrator spelling in body value' 0 Bash 'gh pr merge 123 --body "--admin"' || failed=1
  check 'administrator spelling in inline body' 0 Bash 'gh pr merge 123 --body=--admin' || failed=1
  check 'administrator spelling after option terminator' 0 Bash 'gh pr merge -- --admin' || failed=1
  check 'deletion words as prose' 0 Bash 'printf "%s" "gh repo delete example/project"' || failed=1
  check 'deletion words in another tool' 0 Read 'gh repo delete example/project' || failed=1
  check 'later shell command' 0 Bash 'true; gh repo delete example/project' || failed=1
  check 'administrator spelling in comment' 0 Bash 'gh pr merge 123 # --admin' || failed=1
  check 'root repository option' 2 Bash 'gh -R example/project pr merge 123 --admin' || failed=1
  check 'parent repository option' 2 Bash 'gh pr --repo=example/project merge 123 --admin' || failed=1
  check 'literal redirection character and admin flag' 2 Bash 'gh pr merge 123 -b ">" --admin' || failed=1
  check 'short option group takes a body value' 0 Bash 'gh pr merge 123 -sb "--admin"' || failed=1
  check 'output redirection takes a filename' 0 Bash 'gh pr merge 123 --squash > "--admin"' || failed=1
  check 'short option group with its attached value' 0 Bash 'gh pr merge 123 -sb--admin' || failed=1
  check 'later false flag wins' 0 Bash 'gh pr merge 123 --admin --admin=false' || failed=1
  check 'combined output redirect' 0 Bash 'gh pr merge 123 --admin &> scratch.log' || failed=1
  check 'combined append redirect' 0 Bash 'gh pr merge 123 --admin &>> scratch.log' || failed=1
  check 'repository deletion help' 0 Bash 'gh repo delete --help' || failed=1
  check 'administrator merge help' 0 Bash 'gh pr merge --admin -sh' || failed=1
  check 'literal help spelling in body value' 2 Bash 'gh pr merge 123 -b "--help" --admin' || failed=1
  if [ -e "$GH_CALL_RECEIPT" ] || [ -e "$GIT_CALL_RECEIPT" ]; then
    printf '%s\n' 'Unexpected command execution' >&2
    return 1
  fi
  printf '%s\n' 'GitHub commands executed: 0'
  return "$failed"
}

check_npm() {
  local failed=0
  check 'direct npm publish' 2 Bash 'npm publish' || failed=1
  check 'publish a tarball with a tag' 2 Bash 'npm publish fixture.tgz --tag canary' || failed=1
  check 'explicit npm path and joined words' 2 Bash "\"$scratch/bin/npm\" pu'bli'sh" || failed=1
  check 'escape in publish word' 2 Bash 'npm pub\lish' || failed=1
  check 'dry-run option on a direct publish' 2 Bash 'npm publish --dry-run' || failed=1
  check 'package preview' 0 Bash 'npm pack --dry-run' || failed=1
  check 'package help' 0 Bash 'npm help publish' || failed=1
  check 'package version inspection' 0 Bash 'npm view example version' || failed=1
  check 'publish words as prose' 0 Bash 'printf "%s" "npm publish"' || failed=1
  check 'unrelated npm script name' 0 Bash 'npm run publish' || failed=1
  check 'owner release entry point name' 0 Bash 'npm run publish:latest' || failed=1
  check 'publish words in another tool' 0 Read 'npm publish' || failed=1
  check 'later publish command' 0 Bash 'true; npm publish' || failed=1
  check 'npm text in a multiline merge body' 0 Bash $'gh pr merge 123 --squash --body "mention npm publish\nmore text"' || failed=1
  check 'npm text in a multiline Git message' 0 Bash $'git commit -m "mention npm publish\nmore text"' || failed=1
  if [ -e "$NPM_CALL_RECEIPT" ]; then
    printf '%s\n' 'Unexpected npm execution' >&2
    return 1
  fi
  printf '%s\n' 'npm commands executed: 0'
  return "$failed"
}

check_recursive_delete() {
  local failed=0
  mkdir -p "$scratch/nested"
  ln -s "$scratch/nested" "$scratch/linked"
  TMPDIR="$scratch" check 'temporary variable descendant' 0 Bash 'rm -rf $TMPDIR/nested' || failed=1
  TMPDIR="$scratch" check 'absolute nested destination' 0 Bash "rm -f -R -- '$scratch/nested'" || failed=1
  TMPDIR="$scratch" check 'two temporary descendants' 0 Bash "rm --recursive --force '$scratch/nested' '$scratch/second'" || failed=1
  check 'recursive flag without force' 0 Bash 'rm -r /fixture-example/data' || failed=1
  check 'force without recursion' 0 Bash 'rm -f /fixture-example/data' || failed=1
  check 'outside the temporary bases' 2 Bash 'rm -rf /fixture-example/data' || failed=1
  check 'temporary base itself' 2 Bash 'rm -rf /tmp' || failed=1
  TMPDIR="$scratch" check 'configured temporary root itself' 2 Bash 'rm -rf $TMPDIR' || failed=1
  check 'relative target' 2 Bash 'rm -rf fixture-data' || failed=1
  TMPDIR="$scratch" check 'parent traversal' 2 Bash "rm -rf '$scratch/nested/../second'" || failed=1
  TMPDIR="$scratch" check 'mixed temporary and outside paths' 2 Bash "rm -rf '$scratch/nested' /fixture-example/data" || failed=1
  TMPDIR="$scratch" check 'linked path' 2 Bash "rm -rf '$scratch/linked/subdir'" || failed=1
  TMPDIR=/fixture-example check 'unverified temporary variable' 2 Bash 'rm -rf $TMPDIR/nested' || failed=1
  TMPDIR="$scratch" check 'quoted variable spelling is literal' 2 Bash "rm -rf '\$TMPDIR/nested'" || failed=1
  if [ -e "$RM_CALL_RECEIPT" ]; then
    printf '%s\n' 'Unexpected deletion command execution' >&2
    return 1
  fi
  printf '%s\n' 'Deletion commands executed: 0'
  return "$failed"
}

case "${1:-}" in
  github) check_github; exit 0 ;;
  npm) check_npm; exit 0 ;;
  recursive-delete) check_recursive_delete; exit 0 ;;
esac

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

export PYTHON_CALL_RECEIPT="$scratch/python-called"
cat > "$scratch/bin/interpreter-override" <<'STUB'
#!/bin/bash
test "$1 $2 ${3##*/}" = "-I -S destructive-command.py" || exit 99
touch "$PYTHON_CALL_RECEIPT"
printf '%s\n' stash
STUB
chmod +x "$scratch/bin/interpreter-override"
HOOK_PYTHON="$scratch/bin/interpreter-override" check 'shared interpreter route' 2 Bash 'git stash drop'
[ -e "$PYTHON_CALL_RECEIPT" ]
[ ! -e "$GIT_CALL_RECEIPT" ]
printf '%s\n' 'Git commands executed: 0'
check_github
check_npm
check_recursive_delete
