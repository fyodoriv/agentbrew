#!/bin/bash
# Test fixture for lib/ci-watch-fail-fast.sh with a fake gh on PATH.
# Run: bash ci-watch-fail-fast.test.sh
set -uo pipefail
SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/ci-watch-fail-fast.sh"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ci-watch-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
FAIL=0

mkdir -p "$ROOT/bin"
# The fake gh serves the next numbered snapshot on each jobs or checks read
# (the last one repeats), applies -q with jq like gh does, and logs each call.
cat >"$ROOT/bin/gh" <<'FAKE'
#!/bin/bash
echo "$*" >>"$FIX/calls"
q=""; args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do [ "${args[$i]}" = "-q" ] && q="${args[$((i + 1))]}"; done
next() { # kind
  local n; n=$(($(cat "$FIX/$1.n" 2>/dev/null || echo 0) + 1)); echo "$n" >"$FIX/$1.n"
  [ -f "$FIX/$1-$n.json" ] || n=$(find "$FIX" -name "$1-*.json" | wc -l | tr -d ' ')
  cat "$FIX/$1-$n.json"
}
case "$*" in
  "api "*"/logs"*) printf '2026-11-28T05:14:00.1Z \033[36;1mnpm run verify\033[0m\n2026-11-28T05:14:01.1Z  FAIL  src/a.test.ts > keeps it short\n2026-11-28T05:14:02.1Z AssertionError: expected 406 to be less than 400\n' ;;
  "run view"*"--json jobs"*) next jobs | jq -r "$q" ;;
  "run view"*) echo '{"workflowName":"CI","headSha":"abc123","attempt":1}' | jq -r "$q" ;;
  "pr checks"*) next checks | jq -r "$q" ;;
  "pr view"*) echo '{"headRefOid":"abc123"}' | jq -r "$q" ;;
  *) echo "fake gh: unexpected $*" >&2; exit 1 ;;
esac
FAKE
chmod +x "$ROOT/bin/gh"

job() { # name status conclusion id
  printf '{"name":"%s","status":"%s","conclusion":"%s","databaseId":%s,"url":"https://github.com/o/r/actions/runs/1234567/job/%s"}' "$1" "$2" "$3" "$4" "$4"
}
chk() { # name bucket id
  printf '{"name":"%s","bucket":"%s","link":"https://github.com/o/r/actions/runs/1234567/job/%s"}' "$1" "$2" "$3"
}

run_case() { # label expected-exit want-text... -- args...
  local label="$1" want_exit="$2"; shift 2
  local wants=()
  while [ "$1" != "--" ]; do wants+=("$1"); shift; done; shift
  local out got
  out="$(env -u BASH_ENV -u ENV FIX="$FIX" PATH="$ROOT/bin:$PATH" bash "$SCRIPT" --repo o/r --interval 0 "$@" 2>&1)"; got=$?
  [ "$got" = "$want_exit" ] || { echo "FAIL $label: expected exit $want_exit, got $got"; echo "$out"; FAIL=1; }
  for w in "${wants[@]}"; do
    grep -Fq -- "$w" <<<"$out" || { echo "FAIL $label: output lacks: $w"; echo "$out"; FAIL=1; }
  done
  if grep -q 'cancel' "$FIX/calls" 2>/dev/null; then echo "FAIL $label: the watcher cancelled the run"; FAIL=1; fi
}
fresh() { FIX="$ROOT/$1"; mkdir -p "$FIX"; }

# 1. First failure: exits on the first failed job while another still runs.
fresh first
echo "{\"jobs\":[$(job A in_progress '' 11),$(job B in_progress '' 12)]}" >"$FIX/jobs-1.json"
echo "{\"jobs\":[$(job A completed failure 11),$(job B in_progress '' 12)]}" >"$FIX/jobs-2.json"
run_case "first failure" 1 "run=1234567 workflow=CI head=abc123 attempt=1" "FAILED: A" \
  "AssertionError: expected 406 to be less than 400" "FAIL  src/a.test.ts" "1 job(s) still running" "--rest" -- 1234567
[ "$(cat "$FIX/jobs.n")" = 2 ] || { echo "FAIL first failure: expected 2 job reads, got $(cat "$FIX/jobs.n")"; FAIL=1; }

# 2. --rest waits for every job, then lists all failures in one list.
fresh rest
echo "{\"jobs\":[$(job A completed failure 11),$(job B in_progress '' 12)]}" >"$FIX/jobs-1.json"
echo "{\"jobs\":[$(job A completed failure 11),$(job B completed timed_out 12),$(job C completed success 13)]}" >"$FIX/jobs-2.json"
run_case "rest lists all" 1 "All jobs finished. 2 failed:" "FAILED: A" "FAILED: B" "one fix" -- --rest 1234567

# 3. All green: exit 0 with the line verify-before-completion accepts.
fresh green
echo "{\"jobs\":[$(job A completed success 11),$(job B completed skipped 12)]}" >"$FIX/jobs-1.json"
run_case "all pass" 0 "Run CI (1234567) completed with 'success'" -- 1234567

# 4. PR mode: one early green read is not enough when a slower check registers later.
fresh pr
echo "[$(chk lint pass 21)]" >"$FIX/checks-1.json"
echo "[$(chk lint pass 21),$(chk verify pending 22)]" >"$FIX/checks-2.json"
echo "[$(chk lint pass 21),$(chk verify fail 22)]" >"$FIX/checks-3.json"
run_case "pr late check" 1 "pr=1373 head=abc123" "FAILED: verify" -- https://github.com/o/r/pull/1373

# 5. PR mode green needs two equal all-pass reads.
fresh prgreen
echo "[$(chk lint pass 21),$(chk verify pass 22)]" >"$FIX/checks-1.json"
run_case "pr green" 0 "All 2 checks on PR 1373 passed." -- 1373
[ "$(cat "$FIX/checks.n")" = 2 ] || { echo "FAIL pr green: expected 2 reads, got $(cat "$FIX/checks.n")"; FAIL=1; }

# 6. Hard timeout.
fresh slow
echo "{\"jobs\":[$(job A in_progress '' 11)]}" >"$FIX/jobs-1.json"
run_case "timeout" 124 "timed out" -- --timeout 0 1234567

[ "$FAIL" = 0 ] && echo "ci-watch-fail-fast: all passed"
exit $FAIL
