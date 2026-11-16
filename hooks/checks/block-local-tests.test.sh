#!/bin/bash
# Test fixture for checks/block-local-tests.sh. Run: bash block-local-tests.test.sh
set -uo pipefail
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/block-local-tests.sh"
FAIL=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/block-local-tests.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
# A fake agentbrew checkout (the two marker files) and a plain folder.
CHECKOUT="$TMP/agentbrew"
OTHER="$TMP/other"
mkdir -p "$CHECKOUT/hooks" "$CHECKOUT/src/hooks" "$CHECKOUT/sub" "$OTHER"
: > "$CHECKOUT/hooks/manifest.yaml"
: > "$CHECKOUT/src/hooks/manifest.ts"
unset AGENTBREW_ALLOW_LOCAL_TESTS HOOK_BYPASS_BLOCK_LOCAL_TESTS

check() { # expected-exit command [cwd] [env assignment]
  local input got
  input=$(jq -nc --arg c "$2" --arg d "${3:-$CHECKOUT}" '{hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c},cwd:$d}')
  if [ -n "${4:-}" ]; then
    echo "$input" | env "$4" bash "$SCRIPT" >/dev/null 2>&1; got=$?
  else
    echo "$input" | bash "$SCRIPT" >/dev/null 2>&1; got=$?
  fi
  if [ "$got" != "$1" ]; then echo "FAIL: expected $1, got $got: $2 (cwd ${3:-checkout})"; FAIL=1; fi
}

# Direct test runs are blocked in a checkout.
for c in "npx vitest run src/x.test.ts" "vitest" "npm test" "npm t" "npm run test:all" \
         "npm run test:real-e2e" "npm run verify" "npm run verify:changed" "npm run check:oss" \
         "pnpm test" "yarn test:all" "node --test scripts/x.test.mjs" "npx playwright test" \
         "bash scripts/verify.sh" "bash scripts/run-hook-fixtures.sh" "heavy-run npm run verify" \
         "NO_CACHE=1 npm run verify" "npm run lint && npm test" "cd sub && npx vitest run" \
         "npm --prefix . run test:all" "npm test | tail -5"; do
  check 2 "$c"
done

# Launchers: xargs, find -exec, npx, npm exec, pnpm dlx, bash -c, eval.
for c in "ls src | xargs npx vitest run" "xargs -n1 -I{} npx vitest run {}" "ls | xargs --replace vitest {}" \
         "find src -name '*.test.ts' -exec npx vitest run {} +" "find . -execdir vitest {} \\;" \
         "npx vitest" "npm exec vitest" "npm exec -- vitest run" "npm x vitest" \
         "npm exec -c 'vitest run'" "npx -c 'npm test'" "pnpm dlx vitest run" "pnpm exec vitest" \
         "bash -c 'npm run test:all'" "npx -p @vitest/x vitest" "yarn vitest" "pnpm vitest run" \
         "bun test" "npx tsx --test x.ts" "sh -c \"npx vitest run\"" "eval npm test" "eval 'npm run verify'"; do
  check 2 "$c"
done

# A command that names the checkout folder is blocked from any session folder.
check 2 "cd $CHECKOUT && npm test" "$OTHER"

# Allowed: lint, typecheck, build, read-only commands, one hook's own fixture.
for c in "npm run lint" "npm run lint:changed" "npx tsc --noEmit" "npm run typecheck" "npm run build" \
         "shellcheck hooks/checks/block-local-tests.sh" "rg vitest src" "cat src/x.test.ts" \
         "ls | xargs rg vitest" "find . -exec rg vitest {} +" "npm exec biome check src" \
         "pnpm dlx prettier ." "npx -c 'tsc --noEmit'" "git commit -m 'npm test'" \
         "echo 'npm test' | xargs echo" "vitest --version" "npx vitest list" \
         "bash hooks/checks/block-local-tests.test.sh" "gh pr checks 1 --watch" "npm run verify:build-pipeline" "yarn biome check src"; do
  check 0 "$c"
done

# Allowed: test runs outside an agentbrew checkout.
check 0 "npm test" "$OTHER"
check 0 "npx vitest run" "$OTHER"

# Opt-out from the hook's own environment.
check 0 "npm test" "$CHECKOUT" "AGENTBREW_ALLOW_LOCAL_TESTS=1"
check 0 "npm test" "$CHECKOUT" "HOOK_BYPASS_BLOCK_LOCAL_TESTS=1"
# Setting it in the command text does not opt out.
check 2 "AGENTBREW_ALLOW_LOCAL_TESTS=1 npm test"

[ "$FAIL" = 0 ] && echo "block-local-tests: all passed"
exit $FAIL
