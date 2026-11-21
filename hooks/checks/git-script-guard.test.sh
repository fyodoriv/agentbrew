#!/bin/bash
set -euo pipefail

hooks_dir="$(CDPATH='' cd -- "${BASH_SOURCE[0]%/*}/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/shared" "$fixture/linked" "$fixture/home" "$fixture/deployed/lib"
mkdir -p "$fixture/shared/docs"
touch "$fixture/shared/docs/fixture-file"
export GIT_FIXTURE_RECORD="$fixture/calls"
export GIT_FIXTURE_OBJECT_LOOKUP="$fixture/object-lookups"
fixture_path="$fixture/bin:/usr/bin:/bin"
unset BASH_ENV ENV

cat >"$fixture/bin/git" <<'RECORDER'
#!/bin/bash
set -euo pipefail
if [[ " $* " == *" rev-parse "* ]]; then
  if [[ " $* " == *" --show-toplevel --show-prefix "* ]]; then
    printf '%s\n\n' "$PWD"
    exit 0
  fi
  [[ "${GIT_FIXTURE_PROBE_ERROR:-}" != 1 ]] || exit 128
  if [[ " $* " == *" linked "* ]]; then
    printf '%s\n' '/scratch/shared/.git/worktrees/linked' '/scratch/shared/.git'
  else
    printf '%s\n' '/scratch/shared/.git' '/scratch/shared/.git'
  fi
  exit 0
fi
if [[ "$#" == 2 && "$1" == check-ref-format ]]; then
  exec /usr/bin/git "$@"
fi
if [[ " $* " == *" show-ref --verify --quiet -- "* ]]; then
  printf '%s\n' 'object lookup' >>"$GIT_FIXTURE_OBJECT_LOOKUP"
  [[ "${GIT_FIXTURE_REF_ERROR:-}" != 1 ]] || exit 1
  [[ "${!#}" == refs/heads/feat/fixture-branch ]]
  exit
fi
if [[ " $* " == *" show-ref --exists -- "* ]]; then
  if [[ "${GIT_FIXTURE_REF_ERROR:-}" == 1 ]]; then
    printf '%s\n' 'synthetic-private-marker' >&2
    exit 1
  fi
  [[ "${!#}" != refs/heads/feat/fixture-branch ]] || exit 0
  exit 2
fi
printf '%s\0' "$@" >"$GIT_FIXTURE_RECORD"
printf '%s\n' 'git received the call'
RECORDER
chmod +x "$fixture/bin/git"

cat >"$fixture/change.sh" <<'SCRIPT'
#!/bin/bash
git reset --hard
SCRIPT
cat >"$fixture/alias.sh" <<'SCRIPT'
#!/bin/bash
shopt -s expand_aliases
alias fixture_git=git
fixture_git reset --hard
SCRIPT

cd "$fixture/shared"
/usr/bin/env PATH="$fixture_path" /bin/sh -c 'git reset --hard' >"$fixture/baseline"
[[ -s "$GIT_FIXTURE_RECORD" ]]
rm "$GIT_FIXTURE_RECORD"

export CLAUDE_ENV_FILE="$fixture/session.env"
printf 'export KEEP_ME=present\n' >"$CLAUDE_ENV_FILE"
cp "$hooks_dir/checks/git-script-guard.sh" "$fixture/deployed/git-script-guard.sh"
cp "$hooks_dir/lib/git" "$fixture/deployed/lib/git"
cp "$hooks_dir/lib/stdin-json.sh" "$hooks_dir/lib/bootstrap-endpoint-path.sh" "$fixture/deployed/lib/"
/bin/bash "$fixture/deployed/git-script-guard.sh" <<<'{"hook_event_name":"SessionStart"}'
export PATH="$fixture_path"
# A shell inside this fixture gets the same environment file Claude uses.
source "$CLAUDE_ENV_FILE"
[[ "$KEEP_ME" == present ]]
[[ "${AGENTBREW_SESSION_GIT_GUARD:-}" == "$fixture/deployed/lib/git" ]]

blocked() {
  local rc=0
  rm -f "$GIT_FIXTURE_RECORD"
  "$@" >"$fixture/stdout" 2>"$fixture/stderr" || rc=$?
  if [[ "$rc" != 2 || -e "$GIT_FIXTURE_RECORD" || -s "$fixture/stdout" ]] ||
    ! /usr/bin/grep -qF 'agentbrew git guard:' "$fixture/stderr" ||
    /usr/bin/grep -qF 'synthetic-private-marker' "$fixture/stderr"; then
    printf 'Expected a git guard refusal, got exit %s\n' "$rc" >&2
    exit 1
  fi
}

allowed() {
  local -a arguments=("$@")
  rm -f "$GIT_FIXTURE_RECORD"
  git "${arguments[@]}" >"$fixture/stdout" 2>"$fixture/stderr"
  printf '%s\0' "${arguments[@]}" >"$fixture/expected"
  /usr/bin/cmp "$fixture/expected" "$GIT_FIXTURE_RECORD"
  [[ "$(<"$fixture/stdout")" == 'git received the call' && ! -s "$fixture/stderr" ]]
}

blocked /bin/sh -c 'git reset --hard'
blocked /bin/bash "$fixture/change.sh"
blocked /bin/bash "$fixture/alias.sh"
blocked git clean -fd
blocked git clean -if
blocked git checkout HEAD -- .
blocked git restore .
blocked git restore :/
blocked git switch -c another-branch
blocked git stash drop
blocked git stash clear -- 'synthetic-private-marker'
blocked git commit --no-verify -m 'sample'
blocked git push -f origin main

allowed status --short
allowed diff --stat
allowed log -1 --oneline
allowed worktree list
allowed stash list
allowed stash show --stat
allowed stash apply
allowed checkout HEAD -- 'one file.txt'
allowed commit -m 'sample'
allowed push origin topic
allowed -C linked switch -c another-branch
allowed clean -nfd
allowed checkout HEAD -- -b
allowed reset HEAD -- --hard
allowed push -f main topic
allowed commit --no-verify --verify -m sample
GIT_FIXTURE_PROBE_ERROR=1 blocked git reset --hard

blocked "$AGENTBREW_SESSION_GIT_GUARD" --agentbrew-check-only "$fixture/bin/git" reset --hard
rm -f "$GIT_FIXTURE_RECORD"
"$AGENTBREW_SESSION_GIT_GUARD" --agentbrew-check-only "$fixture/bin/git" status --short
[[ ! -e "$GIT_FIXTURE_RECORD" ]]

mkdir -p "$fixture/real"
scratch_git() {
  /usr/bin/env -i HOME="$fixture/home" PATH="$1" git -C "$fixture/real" "${@:2}"
}
scratch_git /usr/bin:/bin init --template= -q
printf '%s\n' fixture >"$fixture/real/sample.txt"
scratch_git /usr/bin:/bin status --porcelain >"$fixture/direct"
[[ -s "$fixture/direct" ]]
scratch_git "$fixture/deployed/lib:/usr/bin:/bin" status --porcelain >"$fixture/guarded"
/usr/bin/cmp "$fixture/direct" "$fixture/guarded"
printf '%s\n' 'Ten blocked and ten allowed cases matched, plus script, linked-checkout and compatibility controls.'
printf '%s\n' 'Real Git status output stayed byte-identical.'

allowed -C linked checkout feat/fixture-branch
allowed -C linked switch feat/fixture-branch
allowed checkout -- feat/fixture-branch
allowed checkout docs/fixture-file
allowed checkout 'docs/fixture file'

named_branch_failure=0
for subcommand in checkout switch; do
  if (blocked git "$subcommand" feat/fixture-branch); then
    printf 'Shared named branch %s: refused before Git\n' "$subcommand"
  else
    printf 'Shared named branch %s: refusal missing\n' "$subcommand" >&2
    named_branch_failure=1
  fi
done
GIT_FIXTURE_REF_ERROR=1 allowed checkout -- feat/fixture-branch
if (GIT_FIXTURE_REF_ERROR=1 blocked git checkout feat/fixture-branch); then
  printf '%s\n' 'Branch lookup error: refused before Git'
else
  printf '%s\n' 'Branch lookup error: refusal missing' >&2
  named_branch_failure=1
fi
if [[ -e "$GIT_FIXTURE_OBJECT_LOOKUP" ]]; then
  printf 'Object-resolving queries: %s (expected 0)\n' "$(wc -l <"$GIT_FIXTURE_OBJECT_LOOKUP")" >&2
  named_branch_failure=1
else
  printf '%s\n' 'Object-resolving queries: 0'
fi
[[ "$named_branch_failure" == 0 ]]

system_git_path=/usr/bin:/bin
guarded_git_path="$fixture/deployed/lib:$system_git_path"
mkdir -p "$fixture/real/docs"
printf '%s\n' fixture-file >"$fixture/real/docs/fixture-file"
scratch_git "$system_git_path" add docs/fixture-file
scratch_git "$system_git_path" -c user.name=Fixture -c user.email=fixture@example.com \
  -c commit.gpgSign=false commit -qm 'Seed shared branch fixture'
scratch_git "$system_git_path" config remote.fixture.url "$fixture/absent-remote"
scratch_git "$system_git_path" config remote.fixture.fetch '+refs/heads/*:refs/remotes/fixture/*'
seed_commit="$(scratch_git "$system_git_path" rev-parse HEAD)"
for shape in checkout terminated switch linked; do
  scratch_git "$system_git_path" update-ref "refs/remotes/fixture/feat/guess-$shape" "$seed_commit"
done

shared_guess_refused() {
  local shape="$1" before after command_status=0 reference_status=0
  shift
  before="$(scratch_git "$system_git_path" symbolic-ref HEAD)"
  scratch_git "$guarded_git_path" "$@" >"$fixture/stdout" 2>"$fixture/stderr" || command_status=$?
  after="$(scratch_git "$system_git_path" symbolic-ref HEAD)"
  scratch_git "$system_git_path" show-ref --exists -- "refs/heads/feat/guess-$shape" 2>/dev/null || reference_status=$?
  if [[ "$command_status" != 2 || "$reference_status" != 2 || "$before" != "$after" ]] ||
    ! /usr/bin/grep -qF 'agentbrew git guard:' "$fixture/stderr"; then
    printf 'Shared remote branch %s: expected refusal and unchanged refs, got Git exit %s and ref status %s\n' \
      "$shape" "$command_status" "$reference_status" >&2
    return 1
  fi
  printf 'Shared remote branch %s: refused with unchanged HEAD and refs\n' "$shape"
}

remote_guess_failure=0
shared_guess_refused checkout checkout feat/guess-checkout || remote_guess_failure=1
shared_guess_refused terminated checkout feat/guess-terminated -- || remote_guess_failure=1
shared_guess_refused switch switch feat/guess-switch || remote_guess_failure=1

scratch_git "$system_git_path" worktree add --quiet --detach "$fixture/real-linked"
scratch_git "$guarded_git_path" -C "$fixture/real-linked" switch feat/guess-linked >"$fixture/stdout" 2>"$fixture/stderr"
[[ "$(scratch_git "$system_git_path" -C "$fixture/real-linked" symbolic-ref HEAD)" == refs/heads/feat/guess-linked ]]

printf '%s\n' changed >"$fixture/real/docs/fixture-file"
scratch_git "$guarded_git_path" checkout docs/fixture-file >"$fixture/stdout" 2>"$fixture/stderr"
[[ "$(<"$fixture/real/docs/fixture-file")" == fixture-file ]]
/bin/rm -- "$fixture/real/docs/fixture-file"
scratch_git "$guarded_git_path" checkout -- docs/fixture-file >"$fixture/stdout" 2>"$fixture/stderr"
[[ "$(<"$fixture/real/docs/fixture-file")" == fixture-file ]]
printf '%s\n' 'Linked branch guessing and both file controls passed in the disposable Git checkout.'
[[ "$remote_guess_failure" == 0 ]]
