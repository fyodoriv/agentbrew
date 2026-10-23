#!/bin/bash
# Test fixture for checks/updates-landed.sh
#
# SessionStart hook: when dotfiles' `dotfiles-updates-landed` exists, pass
# its one line (updates landed; run the checkup) to the agent as context.
# Silent when the script is missing or prints nothing.
# Run: `bash updates-landed.test.sh`

set -uo pipefail

HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")"
SCRIPT="$HERE/updates-landed.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
mkdir -p "$HOME" "$TMP/bin"
unset HOOK_BYPASS_UPDATES_LANDED AGENTBREW_UPDATES_LANDED_BIN BASH_ENV ENV CLAUDE_CODE_ENTRYPOINT
PASS=0
FAIL=0
FAIL_DETAILS=()
check() { if [ "$2" = "0" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); FAIL_DETAILS+=("$1"); fi; }
run() { printf '%s' '{"hook_event_name":"SessionStart","cwd":"/tmp"}' | PATH="$1" bash "$SCRIPT" 2>/dev/null; }

# Test 1: the script prints a line -> SessionStart additionalContext with it.
printf '#!/bin/sh\necho "Updates landed: dotfiles 3 commits. Run /tooling-checkup."\n' > "$TMP/bin/dotfiles-updates-landed"
chmod +x "$TMP/bin/dotfiles-updates-landed"
OUT="$(run "$TMP/bin:/usr/bin:/bin")"
check "Test 1a (context JSON: $OUT)" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName=="SessionStart" and (.hookSpecificOutput.additionalContext|contains("Updates landed: dotfiles 3 commits"))' >/dev/null 2>&1 && echo 0 || echo 1)"
check "Test 1b (it tells the agent to offer the checkup)" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext|test("suggest";"i")' >/dev/null 2>&1 && echo 0 || echo 1)"

# Test 2: the script prints nothing -> silent.
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/dotfiles-updates-landed"
OUT="$(run "$TMP/bin:/usr/bin:/bin")"
check "Test 2 (nothing new -> silent: $OUT)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

# Test 3: no script on PATH -> silent, exit 0.
OUT="$(run "/usr/bin:/bin")"; RC=$?
check "Test 3 (missing script -> silent, rc 0)" "$([ -z "$OUT" ] && [ "$RC" = 0 ] && echo 0 || echo 1)"

# Test 4: AGENTBREW_UPDATES_LANDED_BIN points at the script.
printf '#!/bin/sh\necho "Updates landed: x."\n' > "$TMP/other"; chmod +x "$TMP/other"
OUT="$(printf '%s' '{"hook_event_name":"SessionStart"}' | AGENTBREW_UPDATES_LANDED_BIN="$TMP/other" PATH="/usr/bin:/bin" bash "$SCRIPT" 2>/dev/null)"
check "Test 4 (env override: $OUT)" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext|contains("Updates landed: x.")' >/dev/null 2>&1 && echo 0 || echo 1)"

# Test 5: a hung script never blocks the session (killed after the timeout).
printf '#!/bin/sh\nsleep 30\necho late\n' > "$TMP/bin/dotfiles-updates-landed"
START=$(date +%s); OUT="$(run "$TMP/bin:/usr/bin:/bin")"; ELAPSED=$(( $(date +%s) - START ))
check "Test 5 (hung script -> silent within 5s, took ${ELAPSED}s)" "$([ -z "$OUT" ] && [ "$ELAPSED" -lt 5 ] && echo 0 || echo 1)"

# Test 6: bypass.
printf '#!/bin/sh\necho "Updates landed: y."\n' > "$TMP/bin/dotfiles-updates-landed"
OUT="$(printf '%s' '{"hook_event_name":"SessionStart"}' | HOOK_BYPASS_UPDATES_LANDED=1 PATH="$TMP/bin:/usr/bin:/bin" bash "$SCRIPT" 2>/dev/null)"
check "Test 6 (bypass -> silent)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

# Test 7: only a fresh, interactive start spends the day's line.
for src in resume clear compact; do
  OUT="$(printf '{"hook_event_name":"SessionStart","source":"%s"}' "$src" | PATH="$TMP/bin:/usr/bin:/bin" bash "$SCRIPT" 2>/dev/null)"
  check "Test 7 (source $src -> silent)" "$([ -z "$OUT" ] && echo 0 || echo 1)"
done
OUT="$(printf '{"hook_event_name":"SessionStart","source":"startup"}' | PATH="$TMP/bin:/usr/bin:/bin" bash "$SCRIPT" 2>/dev/null)"
check "Test 7b (source startup -> context)" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null 2>&1 && echo 0 || echo 1)"
OUT="$(printf '{"hook_event_name":"SessionStart","source":"startup"}' | CLAUDE_CODE_ENTRYPOINT=sdk-cli PATH="$TMP/bin:/usr/bin:/bin" bash "$SCRIPT" 2>/dev/null)"
check "Test 7c (headless sdk entrypoint -> silent)" "$([ -z "$OUT" ] && echo 0 || echo 1)"

echo ""
echo "updates-landed.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then for d in "${FAIL_DETAILS[@]}"; do echo "  ✗ $d"; done; exit 1; fi
exit 0
