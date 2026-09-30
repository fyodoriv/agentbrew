#!/bin/bash
# Bootstrap dotfiles/bin + fnm node before agentbrew hook subprocesses run.
#
# Claude Code / Cursor hooks use sandbox PATH (/opt/homebrew/bin:/usr/bin:/bin)
# without dotfiles shims unless we prepend here. Cursor wraps some hooks via
# with-endpoint-path.sh; deployed hooks under ~/.claude/codeassist/hooks-scripts/
# must bootstrap themselves.
#
# Usage:
#   source "$__HOOK_LIB_DIR/bootstrap-endpoint-path.sh"   # in hook scripts
#   bootstrap-endpoint-path.sh                            # standalone no-op hook

set -euo pipefail

unset BASH_ENV ENV

_dotfiles_resolve_dir() {
  if [ -n "${DOTFILES_DIR:-}" ] && [ -d "${DOTFILES_DIR}/bin" ]; then
    printf '%s\n' "$DOTFILES_DIR"
    return 0
  fi
  local candidate home="${HOME:-}"
  for candidate in \
    "${home}/apps/tooling/dotfiles" \
    "${home}/apps/dotfiles" \
    "${home}/dotfiles"; do
    if [ -d "${candidate}/bin" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

_dotfiles_bootstrap_endpoint_hook_env() {
  local dotfiles_dir="${1:-}"
  local home="${2:-${HOME:-}}"
  local lib_root="$dotfiles_dir"

  if [ -z "$lib_root" ] || [ ! -f "$lib_root/lib/dotfiles-endpoint-paths.sh" ]; then
    lib_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd 2>/dev/null || true)"
  fi
  [ -f "$lib_root/lib/dotfiles-endpoint-paths.sh" ] || return 0

  # shellcheck source=../../dotfiles/lib/dotfiles-endpoint-paths.sh
  source "$lib_root/lib/dotfiles-endpoint-paths.sh"

  if [ -n "$dotfiles_dir" ]; then
    export DOTFILES_DIR="$dotfiles_dir"
    dotfiles_prepend_endpoint_tool_paths "$dotfiles_dir/bin"
  elif [ -d "$lib_root/bin" ]; then
    export DOTFILES_DIR="$lib_root"
    dotfiles_prepend_endpoint_tool_paths "$lib_root/bin"
  fi

  local jq_path find_path fnm_bin py_path py13_path
  jq_path="$(dotfiles_resolve_jq "$dotfiles_dir" "$home" 2>/dev/null || true)"
  find_path="$(dotfiles_resolve_find "${dotfiles_dir:+$dotfiles_dir/bin}" 2>/dev/null || true)"
  fnm_bin="$(dotfiles_resolve_fnm_node_bin "$home" 2>/dev/null || true)"
  py_path="$(dotfiles_resolve_python "$dotfiles_dir" "$home" python3 2>/dev/null || true)"
  py13_path="$(dotfiles_resolve_python "$dotfiles_dir" "$home" python3.13 2>/dev/null || true)"

  [ -n "$jq_path" ] && export DOTFILES_JQ="$jq_path"
  [ -n "$find_path" ] && export DOTFILES_FIND="$find_path"
  [ -n "$py_path" ] && export DOTFILES_PYTHON3="$py_path"
  [ -n "$py13_path" ] && export DOTFILES_PYTHON3_13="$py13_path"
  if [ -n "$fnm_bin" ]; then
    case ":${PATH:-}:" in
      *":$fnm_bin:"*) ;;
      *) export PATH="$fnm_bin:${PATH:-}" ;;
    esac
  fi
}

# When sourced, bootstrap immediately.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  _df_dir="$(_dotfiles_resolve_dir || true)"
  _dotfiles_bootstrap_endpoint_hook_env "$_df_dir" "${HOME:-}"
  unset _df_dir
  return 0 2>/dev/null || exit 0
fi

# Standalone: consume hook stdin (if any) and exit 0.
if [ ! -t 0 ]; then
  cat >/dev/null || true
fi
_df_dir="$(_dotfiles_resolve_dir || true)"
_dotfiles_bootstrap_endpoint_hook_env "$_df_dir" "${HOME:-}"
unset _df_dir
exit 0
