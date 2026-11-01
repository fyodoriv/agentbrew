#!/bin/bash
# Test fixture for checks/no-home-crawl.sh
#
# Hook contract: PreToolUse on Bash, verdict BLOCK (exit 2) when rg, grep -r,
# ag, fd, or find would search $HOME, ~/Library, ~/Library/Application Support,
# or /. Narrower paths, depth <= 2, and AGENTBREW_ALLOW_HOME_SEARCH=1 allow.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-home-crawl.sh"
FAKE_HOME="$(mktemp -d)"
export HOME="$FAKE_HOME"
export HOOK_DECISIONS_LOG="$FAKE_HOME/decisions.jsonl"
unset AGENTBREW_ALLOW_HOME_SEARCH HOOK_BYPASS_NO_HOME_CRAWL
trap 'rm -rf "$FAKE_HOME"' EXIT

PASS=0
FAIL=0
FAIL_DETAILS=()

# check <label> <expected-exit> <cwd> <command> [ENV=VAL]
check() {
  local label="$1" expected="$2" cwd="$3" command="$4" envset="${5:-}"
  local input actual
  input="$(jq -nc --arg c "$command" --arg d "$cwd" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$d,tool_input:{command:$c}}')"
  if [ -n "$envset" ]; then
    actual=$(printf '%s' "$input" | env "$envset" bash "$SCRIPT" 2>/dev/null; echo $?)
  else
    actual=$(printf '%s' "$input" | bash "$SCRIPT" 2>/dev/null; echo $?)
  fi
  actual=$(echo "$actual" | tail -1)
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $actual")
  fi
}

H="$FAKE_HOME"
REPO="$H/apps/agentbrew"

# Blocks
check "rg no path from HOME" 2 "$H" "rg -l -i --glob '*.jsonl' -e 'needle'"
check "rg . from HOME" 2 "$H" "rg -l -i --glob '*.jsonl' -e 'needle' ."
check "rg pattern . from HOME" 2 "$H" "rg needle ."
check "rg Library/Application Support" 2 "$H" "rg -l needle .claude/projects 'Library/Application Support/'"
check "rg tilde" 2 "$REPO" "rg needle ~"
check "rg \$HOME" 2 "$REPO" 'rg needle $HOME'
check "rg ~/Library" 2 "$REPO" "rg needle ~/Library"
check "rg root" 2 "$REPO" "rg needle /"
check "grep -r from HOME" 2 "$H" "grep -rn needle ."
check "grep -R no path from HOME" 2 "$H" "grep -Ril needle"
check "find no path from HOME" 2 "$H" "find -name '*.jsonl'"
check "find ~ -name" 2 "$REPO" "find ~ -name '*.jsonl'"
check "fd from HOME" 2 "$H" "fd jsonl"
check "ag from HOME" 2 "$H" "ag needle"
check "cd HOME then rg" 2 "$REPO" "cd ~ && rg needle"
check "piped rg from HOME" 2 "$REPO" "echo hi | rg needle ~ | head"
check "nice wrapper" 2 "$H" "nice -n 15 rg needle"
check "bash -c inner rg" 2 "$REPO" "bash -c \"rg needle ~\""
check "sh -c inner find" 2 "$REPO" "sh -c 'find / -name x'"
check "fd ~/Library" 2 "$REPO" "fd plist ~/Library"
check "grep -r App Support" 2 "$REPO" "grep -r needle \"$H/Library/Application Support\""

# Allows
check "rg repo path from HOME" 0 "$H" "rg needle apps/agentbrew"
check "rg project logs" 0 "$H" "rg -l needle ~/.claude/projects/my-project"
check "rg . inside repo" 0 "$REPO" "rg needle ."
check "rg no path inside repo" 0 "$REPO" "rg needle"
check "rg max-depth 2" 0 "$H" "rg --max-depth 2 needle ."
check "rg max-depth=1" 0 "$H" "rg --max-depth=1 needle"
check "rg max-depth 5 still blocks" 2 "$H" "rg --max-depth 5 needle"
check "fd -d 2" 0 "$H" "fd -d 2 jsonl"
check "find maxdepth 2" 0 "$REPO" "find ~ -maxdepth 2 -name '*.jsonl'"
check "grep without -r" 0 "$H" "grep needle file.txt"
check "bash -c repo rg" 0 "$REPO" "bash -c 'rg needle src'"
check "pipe into grep" 0 "$H" "ls | grep foo"
check "rg in a string arg" 0 "$H" "echo 'rg needle ~'"
check "inline opt-out" 0 "$H" "AGENTBREW_ALLOW_HOME_SEARCH=1 rg needle"
check "env opt-out" 0 "$H" "rg needle" "AGENTBREW_ALLOW_HOME_SEARCH=1"
check "bypass var" 0 "$H" "rg needle" "HOOK_BYPASS_NO_HOME_CRAWL=1"

# Review round 1 (#490)
check "sudo -u wrapper" 2 "$REPO" "sudo -u me rg needle ~"
check "timeout wrapper" 2 "$REPO" "timeout 60 rg needle ~"
check "gtimeout -s wrapper" 2 "$REPO" "gtimeout -s KILL 60 rg needle ~"
check "stdbuf wrapper" 2 "$H" "stdbuf -oL rg needle"
check "caffeinate wrapper" 2 "$REPO" "caffeinate -i find / -name x"
check "zsh -lc" 2 "$REPO" "zsh -lc 'rg needle ~'"
check "bash -lc" 2 "$REPO" "bash -lc 'rg needle ~'"
check "fd --base-directory" 2 "$REPO" "fd needle --base-directory ~"
check "fd --base-directory=" 2 "$REPO" "fd needle --base-directory=$H"
check "pushd then rg" 2 "$REPO" "pushd ~ && rg needle"
check "eval string" 2 "$REPO" "eval \"rg needle ~\""
check "tilde user" 2 "$REPO" "rg needle ~$(basename "$H")"
check "dollar USER" 2 "$REPO" "rg needle $(dirname "$H")/\$USER" "USER=$(basename "$H")"
check "ug from HOME" 2 "$H" "ug needle"
check "ugrep -r ~" 2 "$REPO" "ugrep -r needle ~"
check "fd after pipe still uses cwd" 2 "$H" "echo x | fd jsonl"
check "git log piped to rg from HOME" 0 "$H" "git log | rg needle"
check "cat piped to grep -r from HOME" 0 "$H" "cat f | grep -r needle"
check "quoted single tilde is literal" 0 "$REPO" "rg needle '~'"
check "quoted double tilde is literal" 0 "$REPO" "rg needle \"~\""
check "ugrep without -r" 0 "$H" "ugrep needle file.txt"
check "timeout repo rg" 0 "$H" "timeout 60 rg needle apps/agentbrew"

# Grep and Glob tools
tool_check() {
  local label="$1" expected="$2" tool="$3" path="$4" pattern="$5" actual
  actual=$(jq -nc --arg t "$tool" --arg p "$path" --arg g "$pattern" --arg d "$H" \
    '{tool_name:$t,cwd:$d,tool_input:({pattern:$g} + (if $p == "" then {} else {path:$p} end))}' \
    | bash "$SCRIPT" 2>/dev/null; echo $?)
  actual=$(echo "$actual" | tail -1)
  if [ "$actual" = "$expected" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$label: expected exit $expected, got $actual"); fi
}
tool_check "Grep path HOME" 2 Grep "$H" "needle"
tool_check "Grep no path from HOME" 2 Grep "" "needle"
tool_check "Grep repo path" 0 Grep "$REPO" "needle"
tool_check "Glob ** at HOME" 2 Glob "$H" "**/*.jsonl"
tool_check "Glob ** at Library" 2 Glob "$H/Library" "**/*.plist"
tool_check "Glob shallow at HOME" 0 Glob "$H" "*.md"
tool_check "Glob ** in repo" 0 Glob "$REPO" "**/*.ts"

# macOS /bin/bash 3.2 must parse the hook (a quote inside a $( heredoc broke it).
if /bin/bash -n "$SCRIPT" 2>/dev/null; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("/bin/bash -n rejects the hook"); fi

# Non-Bash tool
NONBASH=$(printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/x","content":"rg x ~"}}' | bash "$SCRIPT" 2>/dev/null; echo $?)
if [ "$(echo "$NONBASH" | tail -1)" = "0" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("non-Bash tool: expected 0"); fi

# Message names a narrower path and the opt-out
MSG=$(jq -nc --arg d "$H" '{tool_name:"Bash",cwd:$d,tool_input:{command:"rg needle"}}' | bash "$SCRIPT" 2>&1 >/dev/null)
if grep -q "~/.claude/projects/<project>" <<<"$MSG" && grep -q "AGENTBREW_ALLOW_HOME_SEARCH=1" <<<"$MSG"; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1)); FAIL_DETAILS+=("block message lacks narrower path or opt-out: $MSG")
fi

echo ""
echo "no-home-crawl.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
