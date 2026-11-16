#!/bin/bash
# agentbrew/hooks/checks/block-local-tests.sh
#
# **Hook**: block-local-tests
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: AGENTS.md "Tests run on hosted CI only" (owner decision 2026-11-16).
#
# Blocks a local test run inside an agentbrew checkout. Hosted CI runs the tests.
# Blocked there: vitest, playwright test, node --test, npm/pnpm/yarn test,
# `run test*`, `run verify*`, `run check:oss`, scripts/verify*.sh and
# scripts/run-hook-fixtures.sh. Also when started by xargs, find -exec, npx,
# bunx, npm exec, pnpm dlx, `bash -c` or eval.
# Allowed: lint, typecheck, build, shellcheck, one hook's own .test.sh, and any
# command outside an agentbrew checkout. A checkout is a folder (or a parent of
# it) that holds both hooks/manifest.yaml and src/hooks/manifest.ts.
# Opt-out: AGENTBREW_ALLOW_LOCAL_TESTS=1 (or HOOK_BYPASS_BLOCK_LOCAL_TESTS=1),
# exported before the agent starts. Setting it inside an agent command has no
# effect: the hook reads its own environment, not the command text.
# Test: bash block-local-tests.test.sh

set -euo pipefail

[ "${AGENTBREW_ALLOW_LOCAL_TESTS:-}" = 1 ] && exit 0
[ "${HOOK_BYPASS_BLOCK_LOCAL_TESTS:-}" = 1 ] && exit 0

input=$(cat)

# Fast exit: most commands hold no word that can start a test run.
case "$input" in
  *vitest*|*test*|*verify*|*playwright*|*check:oss*|*hook-fixtures*) ;;
  *) exit 0 ;;
esac

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"

command="$(json_get "$input" '.tool_input.command' 2>/dev/null || true)"
[ -n "$command" ] || exit 0
cwd="$(json_get "$input" '.cwd' 2>/dev/null || true)"
[ -n "$cwd" ] || cwd="$PWD"

# Quoted text is data, not a command: drop heredoc bodies and replace each
# quoted string with Q. The string after `bash -c`, `sh -c`, `eval` or
# `npx -c`/`npm exec -c` runs as a command, so it moves to its own line at
# the end. Quoted words that look like a path stay, so `cd "~/x/agentbrew"`
# still names its folder.
_strip_text() {
  perl -0777 -pe '
    my @extra;
    s/<<-?\s*(["\x27]?)(\w+)\1([^\n]*\n)(?:.*?\n)??[ \t]*\2[ \t]*$/ $3/gms;
    s/\b(?:ba|z|da)?sh[ \t]+(?:-\w+[ \t]+)*-\w*c\w*[ \t]+("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)/
      my $q = $1; push @extra, substr($q, 1, -1); "sh -c Q"/gse;
    s/\b((?:npx|bunx|(?:npm|pnpm)(?:[ \t]+(?:--prefix|-w|--workspace|-C|--dir|--filter|-F|--loglevel)[ \t]+[^\s;&|]+|[ \t]+-[^\s;&|]+)*[ \t]+(?:exec|x|dlx))(?:[ \t]+-[^\s;&|]+)*?[ \t])(?:-c|--call)[ \t=]+("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)/
      my ($p, $q) = ($1, $2); push @extra, substr($q, 1, -1); "${p}-c Q"/gse;
    s/\beval[ \t]+("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)/
      my $q = $1; push @extra, substr($q, 1, -1); "eval Q"/gse;
    s/("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)/
      my $in = substr($1, 1, -1);
      $in =~ m{^[\w.~\x2f\$-]*\x2f[\w.~\x2f\$-]*$} ? $in : length($in) ? "Q" : ""/gse;
    s/\$\(([^()]*)\)/push @extra, $1; "S"/ge;
    s/`([^`]*)`/push @extra, $1; "S"/ge;
    $_ .= join("", map { "\n$_\n" } @extra);
  '
}

# True when dir (or a parent of it) is an agentbrew checkout.
_is_agentbrew_checkout() {
  local d="$1"
  # shellcheck disable=SC2016,SC2088  # the patterns match literal text
  case "$d" in
    "~") d="$HOME" ;;
    "~/"*) d="$HOME/${d#\~/}" ;;
    '$HOME'|'${HOME}') d="$HOME" ;;
    '$HOME/'*) d="$HOME/${d#\$HOME/}" ;;
    '${HOME}/'*) d="$HOME/${d#\$\{HOME\}/}" ;;
  esac
  case "$d" in /*) ;; *) d="$cwd/$d" ;; esac
  while [ -n "$d" ] && [ "$d" != / ]; do
    if [ -f "$d/hooks/manifest.yaml" ] && [ -f "$d/src/hooks/manifest.ts" ]; then
      return 0
    fi
    d="${d%/*}"
  done
  return 1
}

stripped="$(printf '%s\n' "$command" | _strip_text)"

# Folders the command may run in: the session folder plus every `cd X`,
# `-C X`, `--prefix X` and `--dir X` target it names.
dirs=("$cwd")
while IFS= read -r d; do
  [ -n "$d" ] && dirs+=("$d")
done < <(printf '%s\n' "$stripped" \
  | perl -ne 'while (/(?:^|[;&|(]\s*|\s)(?:cd|-C|--prefix|--dir|--directory)[ \t=]+([^\s;&|()]+)/g) { print "$1\n" }')

# True when an npm script name runs tests.
_is_test_script() {
  case "$1" in
    test|test:*|t|verify|verify:*|check:oss) return 0 ;;
  esac
  return 1
}

# True when one simple command runs a test suite.
_is_test_run() {
  local -a w
  read -r -a w <<< "$1" || true
  while [ "${#w[@]}" -gt 0 ]; do
    case "${w[0]}" in
      *=*|if|while|until|then|do|else|elif|'!'|time|nohup|exec|command|sudo|caffeinate|env|eval|heavy-run|--exclusive)
        w=("${w[@]:1}") ;;
      nice|timeout) w=("${w[@]:1}")
        while [ "${#w[@]}" -gt 0 ] && [[ "${w[0]}" == -* || "${w[0]}" =~ ^[0-9.]+[smhd]?$ ]]; do w=("${w[@]:1}"); done ;;
      -*) w=("${w[@]:1}") ;;
      *) break ;;
    esac
  done
  [ "${#w[@]}" -gt 0 ] || return 1
  local tool="${w[0]##*/}" a
  case "$tool" in
    npm|pnpm|yarn)
      # Global flags (and the values of the common ones) may come first.
      w=("${w[@]:1}")
      while [ "${#w[@]}" -gt 0 ] && [[ "${w[0]}" == -* ]]; do
        case "${w[0]}" in
          --prefix|-w|--workspace|-C|--dir|--filter|-F|--loglevel|--cwd) w=("${w[@]:2}") ;;
          *) w=("${w[@]:1}") ;;
        esac
      done
      [ "${#w[@]}" -gt 0 ] || return 1
      case "${w[0]}" in
        # `npm exec X`, `npm x X` and `pnpm dlx X` start X, like npx.
        exec|x|dlx) _is_test_run "npx ${w[*]:1}"; return ;;
        test|t) return 0 ;;
        run|run-script)
          w=("${w[@]:1}")
          while [ "${#w[@]}" -gt 0 ] && [[ "${w[0]}" == -* ]]; do w=("${w[@]:1}"); done
          [ "${#w[@]}" -gt 0 ] || return 1
          _is_test_script "${w[0]}"; return ;;
      esac
      # `yarn test:all` and `pnpm verify` run the script without `run`.
      [ "$tool" != npm ] && _is_test_script "${w[0]}" && return 0
      return 1 ;;
    xargs|npx|bunx)
      # A launcher: skip its own flags (and their values), then judge the
      # command it starts.
      w=("${w[@]:1}")
      while [ "${#w[@]}" -gt 0 ] && [[ "${w[0]}" == -* ]]; do
        case "$tool:${w[0]}" in
          xargs:-[adEIJLnPRSs]|xargs:--arg-file|xargs:--delimiter|xargs:--max-args|xargs:--max-chars|xargs:--max-procs) w=("${w[@]:2}") ;;
          # GNU `--replace` takes no separate value (`--replace=R` is one word).
          *) w=("${w[@]:1}") ;;
        esac
      done
      [ "${#w[@]}" -gt 0 ] || return 1
      _is_test_run "${w[*]}"
      return ;;
    find)
      # `find ... -exec CMD ...` starts CMD.
      local i
      for i in "${!w[@]}"; do
        case "${w[$i]}" in -exec|-execdir|-ok|-okdir)
          _is_test_run "${w[*]:$((i + 1))}" && return 0 ;;
        esac
      done
      return 1 ;;
    vitest)
      # A lone version or help flag, or `vitest list`, runs no tests.
      case "${w[*]:1}" in --version|-v|--help|-h|list|list\ *) return 1 ;; esac
      return 0 ;;
    playwright)
      [ "${w[1]:-}" = test ] && return 0
      return 1 ;;
    node)
      for a in "${w[@]:1}"; do
        case "$a" in --test|--test=*) return 0 ;; esac
      done
      return 1 ;;
    bash|sh|zsh)
      # `bash scripts/verify.sh` runs the gate.
      _is_test_run "${w[*]:1}"
      return ;;
    verify.sh|verify-changed.sh|run-hook-fixtures.sh)
      return 0 ;;
  esac
  return 1
}

hit=""
while IFS= read -r line; do
  while IFS= read -r seg; do
    seg="${seg#"${seg%%[![:space:]]*}"}"
    [ -n "$seg" ] || continue
    if _is_test_run "$seg"; then hit="$seg"; break 2; fi
  # An empty {} is an xargs or find placeholder, not a brace group.
  done < <(printf '%s\n' "$line" | sed -E 's/\{\}/ARG/g; s/(&&|\|\||;|\||[(){}])/\n/g')
done <<< "$stripped"
[ -n "$hit" ] || exit 0

for d in "${dirs[@]}"; do
  if _is_agentbrew_checkout "$d"; then
    cat >&2 <<'MSG'
[hook block-local-tests] BLOCKED: agentbrew tests run on hosted CI only, not on this machine.
Run `npm run lint`, `npm run typecheck` or `shellcheck <file>` locally. Then push the branch and read CI:
  gh pr checks <number> --repo fyodoriv/agentbrew --watch
  gh run view <run-id> --log-failed
Opt-out: export AGENTBREW_ALLOW_LOCAL_TESTS=1 before the agent starts. See docs/ci.md.
MSG
    exit 2
  fi
done
exit 0
