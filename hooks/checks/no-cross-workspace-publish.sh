#!/bin/bash
# agentbrew/hooks/checks/no-cross-workspace-publish.sh
#
# **Hook**: no-cross-workspace-publish
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: templates/AGENTS.md "Cross-workspace publishing"
#                  + dotfiles bin/gh (the shell backstop for gh pr create)
#
# Blocks publishing outside the session's workspace before the shell runs:
#   - `gh pr create --repo <other>` (or a PR from a repo outside the workspace)
#   - `gh repo fork` (it creates a new repo under your account)
#   - `git push` to a remote whose repo is not the pushed repo's `origin`,
#     or from a repo outside the workspace
#
# The workspace root is $CLAUDE_PROJECT_DIR, else the hook payload `cwd`.
#
# **Approval**: the user approves one target in the current session. The
# agent then sets AGENT_PUBLIC_WRITE_APPROVAL to a value that includes
# `repo=<owner/repo>` (in the agent's environment or as a prefix on the
# command). This is the same variable the dotfiles gh wrapper reads. Repos
# listed in ~/.config/agent-gh-allowlist.txt ($AGENT_GH_ALLOWLIST_FILE) pass
# `gh pr create` and `git push` without approval, as in the wrapper.
#
# **Bypass**: `HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH=1`.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve lib/ — sibling in source layout (agentbrew/hooks/checks/foo.sh → ../lib/),
# subdir in deploy layout (~/.claude/codeassist/hooks-scripts/foo.sh → ./lib/).
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-cross-workspace-publish"

if [ "${HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH=1"
fi

INPUT="$(read_hook_stdin)"
export HOOK_EVENT_NAME
HOOK_EVENT_NAME="$(json_get "$INPUT" '.hook_event_name')"
export HOOK_TOOL_NAME
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"

if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command to check"
fi

# Cheap pre-filter: skip commands with no publishing verb in command position.
PUBLISH_RE='(^|[;&|(]|\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(gh[[:space:]]+(pr[[:space:]]+create|repo[[:space:]]+fork)|git([[:space:]]+-C[[:space:]]+[^[:space:]]+)*[[:space:]]+push)\b'
if ! grep -qE "$PUBLISH_RE" <<<"$COMMAND"; then
  verdict_allow "$HOOK_ID" "no publishing command"
fi

START_DIR="$(json_get "$INPUT" '.cwd')"
[ -n "$START_DIR" ] || START_DIR="$(pwd -P)"
WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$START_DIR}"
WORKSPACE_ROOT="$(cd "$WORKSPACE_ROOT" 2>/dev/null && pwd -P || printf '%s' "$WORKSPACE_ROOT")"

# repo_slug URL_OR_SLUG: prints "owner/repo" in lower case.
repo_slug() {
  local value="${1%/}"
  value="${value%.git}"
  value="${value##*:}"
  value="$(printf '%s' "$value" | awk -F/ '{ if (NF >= 2) print $(NF-1) "/" $NF; else print $0 }')"
  printf '%s' "$value" | tr '[:upper:]' '[:lower:]'
}

# origin_slug DIR: slug of DIR's origin remote, or empty.
origin_slug() {
  local url
  url="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  [ -n "$url" ] && repo_slug "$url"
  return 0
}

# inside_workspace DIR: DIR is the workspace root or below it.
inside_workspace() {
  local dir
  dir="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  [ "$dir" = "$WORKSPACE_ROOT" ] || [ "${dir#"$WORKSPACE_ROOT"/}" != "$dir" ]
}

# approved SLUG APPROVAL: the approval token names SLUG.
approved() {
  local slug="$1"
  local approval="$2"
  [ -n "$approval" ] || return 1
  approval="$(printf '%s' "$approval" | tr '[:upper:]' '[:lower:]')"
  grep -qE "(^|[[:space:]])repo=([^[:space:]]*[/:])?${slug}(\.git)?([[:space:]]|$)" <<<"$approval"
}

# allowlisted SLUG: SLUG is listed in the per-machine agent PR allowlist.
allowlisted() {
  local slug="$1"
  local file="${AGENT_GH_ALLOWLIST_FILE:-$HOME/.config/agent-gh-allowlist.txt}"
  local line
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line//[[:space:]]/}"
    [ -n "$line" ] || continue
    [ "$(repo_slug "$line")" = "$slug" ] && return 0
  done <"$file"
  return 1
}

# deny TARGET REASON: block unless approved or allowlisted.
deny() {
  local slug="$1"
  local reason="$2"
  local allow_list="${3:-yes}"
  if approved "$slug" "$SEG_APPROVAL"; then
    verdict_allow "$HOOK_ID" "approved publish to $slug"
  fi
  if [ "$allow_list" = "yes" ] && [ -n "$slug" ] && allowlisted "$slug"; then
    verdict_allow "$HOOK_ID" "allowlisted publish to $slug"
  fi
  verdict_block "$HOOK_ID" "$reason Publishing outside this workspace needs the user's approval in this session.
Ask the user. After a clear yes, run the command with AGENT_PUBLIC_WRITE_APPROVAL='repo=${slug:-<owner/repo>}' set.
Bypass: HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH=1."
}

# check_gh_pr_create DIR ARGS...
check_gh_pr_create() {
  local dir="$1"
  shift
  local target="" here
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --repo | -R) target="${2:-}"; shift ;;
      --repo=*) target="${1#--repo=}" ;;
      -R?*) target="${1#-R}" ;;
    esac
    shift
  done
  here="$(origin_slug "$dir")"
  if [ -z "$target" ]; then
    inside_workspace "$dir" && return 0
    deny "$here" "gh pr create runs in $dir, outside the workspace $WORKSPACE_ROOT."
  fi
  target="$(repo_slug "$target")"
  if [ "$target" = "$here" ] && inside_workspace "$dir"; then
    return 0
  fi
  deny "$target" "gh pr create targets $target, not this workspace's repo (${here:-unknown})."
}

# check_gh_repo_fork DIR ARGS...
check_gh_repo_fork() {
  local dir="$1"
  shift
  local target=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --remote-name | --org | --fork-name) shift ;;
      -*) ;;
      *) [ -n "$target" ] || target="$1" ;;
    esac
    shift
  done
  [ -n "$target" ] || target="$(origin_slug "$dir")"
  target="$(repo_slug "$target")"
  deny "$target" "gh repo fork creates a new repo from ${target:-this repo}." no
}

# check_git_push DIR ARGS...
check_git_push() {
  local dir="$1"
  shift
  local remote="" url target here branch
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o | --push-option | --receive-pack | --exec) shift ;;
      --repo=*) remote="${1#--repo=}" ;;
      -*) ;;
      *) remote="$1"; break ;;
    esac
    shift
  done
  here="$(origin_slug "$dir")"
  if ! inside_workspace "$dir"; then
    deny "$here" "git push runs in $dir, outside the workspace $WORKSPACE_ROOT."
  fi
  if [ -z "$remote" ]; then
    branch="$(git -C "$dir" symbolic-ref --short -q HEAD 2>/dev/null || true)"
    remote="$(git -C "$dir" config "branch.$branch.pushRemote" 2>/dev/null ||
      git -C "$dir" config remote.pushDefault 2>/dev/null ||
      git -C "$dir" config "branch.$branch.remote" 2>/dev/null || echo origin)"
  fi
  case "$remote" in
    *://* | *@*:* | */*) url="$remote" ;;
    *) url="$(git -C "$dir" remote get-url --push "$remote" 2>/dev/null || true)" ;;
  esac
  [ -n "$url" ] || return 0
  target="$(repo_slug "$url")"
  [ "$target" = "$here" ] && return 0
  deny "$target" "git push targets $target, not this repo's origin (${here:-unknown})."
}

# Walk the command one simple command at a time. `cd DIR` and `git -C DIR`
# change the directory that later commands run in.
CUR_DIR="$START_DIR"
SEGMENTS="$(printf '%s\n' "$COMMAND" | sed -E 's/(&&|\|\||;|\||\$\(|\(|\))/\n/g')"
while IFS= read -r segment; do
  read -r -a words <<<"$segment" || true
  [ "${#words[@]}" -gt 0 ] || continue
  SEG_APPROVAL="${AGENT_PUBLIC_WRITE_APPROVAL:-}"
  # Strip VAR=value prefixes; keep an inline approval token.
  while [ "${#words[@]}" -gt 0 ] && [[ "${words[0]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    if [[ "${words[0]}" == AGENT_PUBLIC_WRITE_APPROVAL=* ]]; then
      SEG_APPROVAL="${segment#*AGENT_PUBLIC_WRITE_APPROVAL=}"
      SEG_APPROVAL="${SEG_APPROVAL#[\"\']}"
      SEG_APPROVAL="${SEG_APPROVAL%%[\"\']*}"
    fi
    words=("${words[@]:1}")
  done
  [ "${#words[@]}" -gt 0 ] || continue
  for i in "${!words[@]}"; do
    w="${words[$i]}"
    w="${w#[\"\']}"
    words[i]="${w%[\"\']}"
  done
  case "${words[0]}" in
    cd)
      target_dir="${words[1]:-$HOME}"
      target_dir="${target_dir/#\~/$HOME}"
      if [ "${target_dir#/}" = "$target_dir" ]; then target_dir="$CUR_DIR/$target_dir"; fi
      CUR_DIR="$target_dir"
      ;;
    gh)
      if [ "${words[1]:-}" = "pr" ] && [ "${words[2]:-}" = "create" ]; then
        check_gh_pr_create "$CUR_DIR" "${words[@]:3}"
      elif [ "${words[1]:-}" = "repo" ] && [ "${words[2]:-}" = "fork" ]; then
        check_gh_repo_fork "$CUR_DIR" "${words[@]:3}"
      fi
      ;;
    git)
      git_dir="$CUR_DIR"
      rest=("${words[@]:1}")
      while [ "${#rest[@]}" -ge 2 ] && [ "${rest[0]}" = "-C" ]; do
        if [ "${rest[1]#/}" = "${rest[1]}" ]; then git_dir="$git_dir/${rest[1]}"; else git_dir="${rest[1]}"; fi
        rest=("${rest[@]:2}")
      done
      if [ "${rest[0]:-}" = "push" ]; then
        check_git_push "$git_dir" "${rest[@]:1}"
      fi
      ;;
  esac
done <<<"$SEGMENTS"

verdict_allow "$HOOK_ID" "publishing stays inside the workspace"
