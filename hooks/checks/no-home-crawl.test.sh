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
check "pipe into grep" 0 "$H" "ls | grep foo"
check "rg in a string arg" 0 "$H" "echo 'rg needle ~'"
check "inline opt-out" 0 "$H" "AGENTBREW_ALLOW_HOME_SEARCH=1 rg needle"
check "env opt-out" 0 "$H" "rg needle" "AGENTBREW_ALLOW_HOME_SEARCH=1"
check "bypass var" 0 "$H" "rg needle" "HOOK_BYPASS_NO_HOME_CRAWL=1"

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
