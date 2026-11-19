#!/bin/bash
set -euo pipefail

hooks_dir="$(CDPATH='' cd -- "${BASH_SOURCE[0]%/*}/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/shared" "$fixture/linked" "$fixture/home" "$fixture/deployed/lib"
export GIT_FIXTURE_RECORD="$fixture/calls"
fixture_path="$fixture/bin:/usr/bin:/bin"
unset BASH_ENV ENV

cat >"$fixture/bin/git" <<'RECORDER'
#!/bin/bash
set -euo pipefail
if [[ " $* " == *" rev-parse "* ]]; then
  [[ "${GIT_FIXTURE_PROBE_ERROR:-}" != 1 ]] || exit 128
  if [[ " $* " == *" linked "* ]]; then
    printf '%s\n' '/scratch/shared/.git/worktrees/linked' '/scratch/shared/.git'
  else
    printf '%s\n' '/scratch/shared/.git' '/scratch/shared/.git'
  fi
  exit 0
fi
printf '%s\0' "$@" >"$GIT_FIXTURE_RECORD"
printf '%s\n' 'git received the call'
RECORDER
chmod +x "$fixture/bin/git"

cat >"$fixture/change.sh" <<'SCRIPT'
#!/bin/bash
git reset --hard
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
