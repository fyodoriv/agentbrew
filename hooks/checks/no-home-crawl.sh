#!/bin/bash
# agentbrew/hooks/checks/no-home-crawl.sh
#
# **Hook**: no-home-crawl
# **Event**: PreToolUse on Bash, Grep, and Glob
# **Verdict**: block
# **Source rule**: owner request 2026-10-25 (load 322: recursive agent
# searches over the home folder made Spotlight and file-provider importers
# re-read files for hours)
#
# Blocks a recursive search whose root is too broad: `rg`, `grep -r/-R`,
# `ag`, `ug`/`ugrep`, `fd`, and `find` (and the Grep and Glob tools) when the
# effective search root is $HOME, ~/Library, ~/Library/Application Support,
# or /. The root is the path argument, or the session cwd when no path is
# given (so `rg foo` from $HOME and `rg foo .` from $HOME both block). A
# `cd <dir> &&` or `pushd <dir> &&` earlier in the same command moves the
# cwd. `bash -c`, `zsh -lc`, and `eval` strings are checked too.
#
# **Allowed**:
#   - any narrower path, such as ~/.claude/projects/<project> or ~/apps/<repo>
#   - a depth limit of 2 or less (`--max-depth`/`-d` for rg and fd,
#     `--depth` for ag, `-maxdepth` for find)
#   - `rg`/`grep` with no path after a pipe (they read stdin, not the cwd)
#   - a Glob pattern without `**`
#
# **Not caught**: roots built at run time, such as `rg x "$(pwd)"` or
# `rg x "$DIR"`; only $HOME, ~, ~user, and $USER are expanded.
#
# **Opt-out**: `AGENTBREW_ALLOW_HOME_SEARCH=1`, in the agent's environment
# or as a prefix on the command itself. `HOOK_BYPASS_NO_HOME_CRAWL=1` works too.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-home-crawl"

if [ "${HOOK_BYPASS_NO_HOME_CRAWL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_HOME_CRAWL=1"
fi
if [ "${AGENTBREW_ALLOW_HOME_SEARCH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "AGENTBREW_ALLOW_HOME_SEARCH=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
COMMAND=""
TOOL_PATH=""
TOOL_GLOB=""
case "$HOOK_TOOL_NAME" in
  Bash)
    COMMAND="$(json_get "$INPUT" '.tool_input.command')"
    if [ -z "$COMMAND" ]; then
      verdict_bypass "$HOOK_ID" "no command to check"
    fi
    # Cheap pre-filter keeps python3 off the hot path for most Bash calls.
    if ! grep -qE '(^|[^[:alnum:]_-])(rg|grep|ag|ug|ugrep|fd|find)([[:space:]]|$|["'"'"'])' <<<"$COMMAND"; then
      verdict_allow "$HOOK_ID" "no search command"
    fi
    ;;
  Grep | Glob)
    TOOL_PATH="$(json_get "$INPUT" '.tool_input.path')"
    TOOL_GLOB="$(json_get "$INPUT" '.tool_input.pattern')"
    ;;
  *)
    verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash, Grep, or Glob"
    ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  verdict_bypass "$HOOK_ID" "python3 not found"
fi

CWD="$(json_get "$INPUT" '.cwd')"
[ -n "$CWD" ] || CWD="$PWD"

# Prints "<tool>\t<root>" for the first too-broad search, or nothing.
FINDING="$(NHC_TOOL="$HOOK_TOOL_NAME" NHC_COMMAND="$COMMAND" NHC_PATH="$TOOL_PATH" NHC_GLOB="$TOOL_GLOB" \
  NHC_CWD="$CWD" NHC_HOME="${HOME:-}" NHC_USER="${USER:-}" python3 "$__HOOK_LIB_DIR/no-home-crawl.py" 2>/dev/null || true)"

if [ -n "$FINDING" ]; then
  TOOL="${FINDING%%$'\t'*}"
  ROOT="${FINDING#*$'\t'}"
  verdict_block "$HOOK_ID" "\`$TOOL\` would search all of $ROOT. Crawls this wide run for many minutes and make Spotlight and the Apple file importers re-read files, so the whole Mac slows down. Search a narrower path instead, such as ~/.claude/projects/<project> for session logs or ~/apps/<repo> for code, or add a depth limit of 2 or less (--max-depth 2, -maxdepth 2). If you really need the wide search, prefix the command with AGENTBREW_ALLOW_HOME_SEARCH=1."
fi

verdict_allow "$HOOK_ID" "search root is narrow enough"
