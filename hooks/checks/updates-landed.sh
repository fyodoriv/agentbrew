#!/bin/bash
# agentbrew/hooks/checks/updates-landed.sh
#
# **Hook**: updates-landed
# **Event**: SessionStart
# **Verdict**: allow (adds context only; never blocks)
# **Source rule**: issue #442 "daily update nudge"
#
# When dotfiles' `dotfiles-updates-landed` is installed, run it and pass its
# one line (background updates landed; run the checkup) to the agent, so the
# agent can suggest the checkup. That script owns the once-a-day limit and
# its state file (dotfiles #311); this hook keeps no state of its own. It
# never fetches, never changes a checkout, and gives up after 3 seconds.
# Running the script marks today's line as shown, so the hook runs only on a
# fresh, interactive session start.
#
# **Bypass**: `HOOK_BYPASS_UPDATES_LANDED=1`
# Override the script path with `AGENTBREW_UPDATES_LANDED_BIN`.

set -uo pipefail

# The hook libraries can put helper dirs first on PATH; find the script on
# the caller's own PATH.
__CALLER_PATH="$PATH"
__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
# shellcheck disable=SC1091
source "$__HOOK_LIB_DIR/verdict.sh"
set +e

readonly HOOK_ID="updates-landed"

[ "${HOOK_BYPASS_UPDATES_LANDED:-0}" = "1" ] && verdict_bypass "$HOOK_ID" "HOOK_BYPASS_UPDATES_LANDED=1"
INPUT="$(read_hook_stdin)"
# The dotfiles script marks its line as shown for the day, so spend it only
# on a session a person is likely to read: a fresh start (not resume,
# clear, or compact), and not a headless SDK run such as `claude -p`.
SOURCE="$(json_get "${INPUT:-{\}}" '.source')"
[ -z "$SOURCE" ] || [ "$SOURCE" = "startup" ] || verdict_bypass "$HOOK_ID" "session source $SOURCE is not startup"
case "${CLAUDE_CODE_ENTRYPOINT:-}" in sdk*) verdict_bypass "$HOOK_ID" "headless entrypoint ${CLAUDE_CODE_ENTRYPOINT}" ;; esac

BIN="${AGENTBREW_UPDATES_LANDED_BIN:-$(PATH="$__CALLER_PATH" command -v dotfiles-updates-landed 2>/dev/null)}"
[ -n "$BIN" ] && [ -x "$BIN" ] || verdict_bypass "$HOOK_ID" "dotfiles-updates-landed not installed"

PERL=/usr/bin/perl
[ -x "$PERL" ] || PERL="$(command -v perl 2>/dev/null)"
[ -n "$PERL" ] || verdict_bypass "$HOOK_ID" "perl not found (needed for the 3 s limit)"
# Run it in its own process group and kill the whole group after 3 s, so a
# hung child cannot hold the output open and stall the session.
LINE="$("$PERL" -e '
  my $pid = fork() // exit 0;
  if ($pid == 0) { setpgrp(0, 0); exec @ARGV or exit 0 }
  $SIG{ALRM} = sub { kill "KILL", -$pid; exit 0 };
  alarm 3;
  waitpid($pid, 0);
' "$BIN" 2>/dev/null | head -n 1)"
[ -n "$LINE" ] || verdict_bypass "$HOOK_ID" "no new updates"

hook_jq -nc --arg line "$LINE" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ($line + " Suggest the checkup to the user once; do not run it without a yes.")}}' || exit 0
verdict_allow "$HOOK_ID" "added the updates-landed line"
