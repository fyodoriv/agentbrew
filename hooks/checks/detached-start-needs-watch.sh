#!/bin/bash
# agentbrew/hooks/checks/detached-start-needs-watch.sh
#
# **Hook**: detached-start-needs-watch
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: shared-rules.md "Fast, safe iterations": every long or background start has a working watch.
#
# A process started with `nohup`, `setsid`, `disown` or a trailing `&` inside a foreground call
# leaves no watch: nothing tells the agent when it ends, or that it never started. On 2026-11-22
# one agent reported 9 background gift refills as running; a single-run lock had refused 8.
#
# Allowed: `run_in_background: true` (the harness reports the exit), a command that checks the
# child in the same call (`kill -0 $!`, `wait`, `pgrep`), and every command with no detach.
# Bypass: HOOK_BYPASS_DETACHED_START_NEEDS_WATCH=1.
# Test: bash detached-start-needs-watch.test.sh

set -euo pipefail
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="detached-start-needs-watch"
if [ "${HOOK_BYPASS_DETACHED_START_NEEDS_WATCH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_DETACHED_START_NEEDS_WATCH=1"
fi

INPUT="$(read_hook_stdin)"
[ "$(json_get "$INPUT" '.tool_name')" = "Bash" ] || verdict_bypass "$HOOK_ID" "not Bash"
[ "$(json_get "$INPUT" '.tool_input.run_in_background')" = "true" ] && verdict_allow "$HOOK_ID" "harness tracks it"
CMD="$(json_get "$INPUT" '.tool_input.command')"

# Heredoc bodies and quoted strings are text, so drop them before the detach match: this
# keeps a PR body or commit message that mentions `nohup … &` from being blocked.
# The rest of a `<<EOF` line stays code; `<<<` is a here-string, not a heredoc.
# A quote opens only at a word start ("don't" is no quote).
TEXTLESS="$(perl -0777 -pe 's/(?<!<)<<(?!<)-?[ \t]*([\x27"]?)(\w+)\1([^\n]*\n)(?:.*?\n)??[ \t]*\2[ \t]*(?=\n|\z)/$3/sg; s/(?<![\w\\])\x27[^\x27]*\x27/Q/g; s/(?<![\w\\])"(?:\\.|[^"\\])*"/Q/g' <<<"$CMD")"
# Fail closed: drop text only when every command in the line is a known data-only command.
# Any other first word (a shell, an interpreter, a path, a quoted or $VAR name) may run the text as code.
# git and gh pass only with these subcommands: others (rebase -x, config alias, extension) run text.
SAFE_CMDS=" echo printf cat ls cd pwd tee mkdir touch cp mv rm head tail wc cut tr diff test [ true false basename dirname date sleep kill wait pgrep curl "
SAFE_GIT=" commit add status log show diff push fetch pull switch checkout branch "
SAFE_GH=" pr issue run repo api "
text_is_data() {
  grep -qE '\$\(|`' <<<"$CMD" && return 1
  local seg word sub
  while IFS= read -r seg; do
    seg="${seg#"${seg%%[![:space:]]*}"}"
    [ -z "$seg" ] && continue
    # A VAR=value prefix can name a program (GIT_SSH_COMMAND, EDITOR), so it keeps the text as code.
    grep -qE '^[A-Za-z_][A-Za-z0-9_]*=' <<<"$seg" && return 1
    word="${seg%%[[:space:]]*}"
    # git and gh options that may name a program (--upload-pack, --receive-pack, --exec and their
    # prefixes, -x, `--` to git).
    if [ "$word" = git ] || [ "$word" = gh ]; then
      grep -qE -- '[[:space:]]--(u|r|e)[[:alpha:]-]*|(^|[[:space:]])-[[:alpha:]]*x([=[:space:]]|$)|[[:space:]]--([[:space:]]|$)' <<<"$seg" && return 1
    fi
    sub="$(awk '{print $2}' <<<"$seg")"
    case "$word" in
      git) case "$SAFE_GIT" in *" $sub "*) ;; *) return 1 ;; esac ;;
      gh) case "$SAFE_GH" in *" $sub "*) ;; *) return 1 ;; esac ;;
      *) case "$SAFE_CMDS" in *" $word "*) ;; *) return 1 ;; esac ;;
    esac
  done < <(sed -E 's/&&|\|\|/\n/g; s/[;&|(){}!]/\n/g' <<<"$TEXTLESS")
  return 0
}
if text_is_data; then CODE="$TEXTLESS"; else CODE="$CMD"; fi
# Drop `&&`, `2>&1`, `&>` and `>&` so only a real detaching `&` is left.
STRIPPED="$(sed -E 's/&&//g; s/[0-9]?>&[0-9]?//g; s/&>//g' <<<"$CODE")"
[ "$CODE" = "$CMD" ] && STRIPPED="$(tr -d "'\"" <<<"$STRIPPED")"
if ! grep -qE '(^|[^[:alnum:]_-])(nohup|setsid|disown)([^[:alnum:]_-]|$)|&' <<<"$STRIPPED"; then
  verdict_allow "$HOOK_ID" "no detach"
fi
# The watch must be a command of its own: a quoted, commented or argument 'wait' is not a watch.
WATCH_CODE="$(sed -E 's/(^|[[:space:]])#.*$//; s/&&|\|\|/;/g' <<<"$TEXTLESS")"
if grep -qE '(^|[;&|])[[:space:]]*(wait|pgrep|kill[[:space:]]+-0)([[:space:]]|$|;)' <<<"$WATCH_CODE"; then
  verdict_allow "$HOOK_ID" "checks the child in the same call"
fi
verdict_block "$HOOK_ID" "this starts a detached process with no watch, so a refused or dead start looks like success. Do one of: (1) drop nohup/& and run the command with run_in_background: true, so the harness tells you when it exits; or (2) keep the detach and check it in the same call, e.g. \`cmd >\"\$LOG\" 2>&1 & pid=\$!; sleep 3; kill -0 \$pid && tail -5 \"\$LOG\"\`. Then confirm a pid, lock or log line before you report it as started."
