#!/bin/bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-merge-preflight.sh"
scratch="$(mktemp -d)"
trap 'rm -r -- "$scratch"' EXIT
mkdir -p "$scratch/bin"
export PATH="$scratch/bin:$PATH" GH_FIXTURE_RECEIPT="$scratch/gh-args"
unset GH_HOST GH_REPO

cat > "$scratch/bin/gh" <<'MOCK'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$@" >> "$GH_FIXTURE_RECEIPT"
if [ "$1" = api ]; then
  [ "${2:-}" = --hostname ] && [ "${3:-}" = github.com ] || exit 96
  case "$GH_FIXTURE_MODE" in
    no-ref) exit 1 ;;
    slow-ref) exec sleep 20 ;;
  esac
  case "${4:-}" in
    repos/fixture/repo/git/ref/heads/main|repos/fixture/alternate/git/ref/heads/main) ref=main ;;
    repos/fixture/repo/git/ref/heads/feat%2Fcheckout) ref=feat/checkout ;;
    *) exit 95 ;;
  esac
  printf '{"ref":"refs/heads/%s","object":{"sha":"%s","type":"commit"}}' "$ref" "$GH_FIXTURE_BASE_SHA"
  exit 0
fi
[ "$1" = pr ] && [ "$2" = view ] || exit 97
case "$GH_FIXTURE_MODE" in
  unavailable) exit 1 ;;
  timeout) exec sleep 20 ;;
  slow-ref) sleep 3 ;;
esac
printf '%s' "$GH_FIXTURE_RESPONSE"
MOCK
chmod +x "$scratch/bin/gh"

head_sha=0123456789abcdef0123456789abcdef01234567
base_sha=1111111111111111111111111111111111111111
advanced_sha=2222222222222222222222222222222222222222
ready="$(jq -nc --arg head "$head_sha" --arg base "$base_sha" '{
  state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headRefOid: $head,
  baseRefName: "main", baseRefOid: $base,
  number: 42, url: "https://github.com/fixture/repo/pull/42",
  statusCheckRollup: [
    {__typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS"},
    {__typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED"},
    {__typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL"},
    {__typename: "StatusContext", state: "SUCCESS"}
  ]
}')"
explicit="gh pr merge 42 -R github.com/fixture/repo --squash --match-head-commit $head_sha"
url="gh pr merge https://github.com/fixture/alternate/pull/73 --squash --match-head-commit=$head_sha"

check() {
  local name="$1" expected="$2" reads="$3" command="$4" response="$5" mode="${6:-status}"
  local status=0 payload
  : > "$GH_FIXTURE_RECEIPT"
  payload="$(jq -nc --arg command "$command" \
    '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $command}}')"
  env -u BASH_ENV -u ENV DOTFILES_DIR="$scratch" \
    GH_FIXTURE_MODE="$mode" GH_FIXTURE_RESPONSE="$response" GH_FIXTURE_BASE_SHA="${7:-$base_sha}" bash "$script" \
    <<< "$payload" > "$scratch/output" 2>&1 || status=$?
  if [ "$status" -ne "$expected" ] || [ "$(grep -Fxc view "$GH_FIXTURE_RECEIPT" || true)" -ne "$reads" ]; then
    printf '%s: expected status %s and %s read(s), got status %s.\n' "$name" "$expected" "$reads" "$status" >&2
    exit 1
  fi
  if grep -Fxq merge "$GH_FIXTURE_RECEIPT"; then
    printf '%s: fixture must never invoke a merge.\n' "$name" >&2
    exit 1
  fi
  if grep -Fq SYNTHETIC_PRIVATE_STATUS "$scratch/output"; then
    printf '%s: fixture status details must stay private.\n' "$name" >&2
    exit 1
  fi
  if [ "$reads" -eq 0 ]; then
    [ ! -s "$GH_FIXTURE_RECEIPT" ]
  fi
  printf 'ok - %s\n' "$name"
}

check 'verified numbered request' 0 1 "$explicit" "$ready"
grep -Fxq 42 "$GH_FIXTURE_RECEIPT"
grep -Fxq github.com/fixture/repo "$GH_FIXTURE_RECEIPT"
check 'verified URL request' 0 1 "$url" "$(jq -c '.number = 73 | .url = "https://github.com/fixture/alternate/pull/73"' <<< "$ready")"
grep -Fxq 73 "$GH_FIXTURE_RECEIPT"
grep -Fxq github.com/fixture/alternate "$GH_FIXTURE_RECEIPT"
check 'unrelated text' 0 0 "printf '%s' '$explicit'" "$ready"
check 'missing head precondition' 2 0 'gh pr merge 42 -R github.com/fixture/repo --squash' "$ready"
check 'missing explicit repository' 2 0 "gh pr merge 42 --match-head-commit $head_sha" "$ready"
check 'unconfigured status host' 2 0 "gh pr merge https://github.example.com/fixture/repo/pull/42 --match-head-commit $head_sha" "$ready"
check 'unadmitted repository host' 2 0 "gh pr merge 42 -R github.example.com/fixture/repo --match-head-commit $head_sha" "$ready"
GH_HOST=github.example.com check 'ambient host cannot route unqualified repository' 2 0 \
  "gh pr merge 42 -R fixture/repo --match-head-commit $head_sha" "$ready"
check 'non-ready head' 2 1 "$explicit" "$(jq -c '.headRefOid |= ("f"*40)' <<< "$ready")"
check 'wrong response repository' 2 1 "$explicit" "$(jq -c '.url = "https://github.com/fixture/other/pull/42"' <<< "$ready")"
check 'pending check' 2 1 "$explicit" "$(jq -c '.statusCheckRollup[0] |= (.status = "IN_PROGRESS" | .conclusion = "")' <<< "$ready")"
check 'failed check' 2 1 "$explicit" "$(jq -c '.statusCheckRollup[0].conclusion = "FAILURE"' <<< "$ready")"
check 'pending legacy check' 2 1 "$explicit" "$(jq -c '.statusCheckRollup[3].state = "PENDING"' <<< "$ready")"
check 'behind' 2 1 "$explicit" "$(jq -c '.mergeStateStatus = "BEHIND"' <<< "$ready")"
check 'conflicting' 2 1 "$explicit" "$(jq -c '.mergeStateStatus = "DIRTY"' <<< "$ready")"
check 'draft' 2 1 "$explicit" "$(jq -c '.isDraft = true' <<< "$ready")"
check 'missing checks' 2 1 "$explicit" "$(jq -c '.statusCheckRollup = []' <<< "$ready")"
check 'malformed response' 2 1 "$explicit" '{SYNTHETIC_PRIVATE_STATUS'
check 'failed fetch' 2 1 "$explicit" '' unavailable

started=$SECONDS
check 'bounded timeout' 2 1 "$explicit" '' timeout
[ "$((SECONDS-started))" -le 8 ]

check 'base ref advanced beyond the passing PR snapshot' 2 1 "$explicit" "$ready" status "$advanced_sha"
check 'current base with a slash' 0 1 "$explicit" "$(jq -c '.baseRefName = "feat/checkout"' <<< "$ready")"
grep -Fxq repos/fixture/repo/git/ref/heads/feat%2Fcheckout "$GH_FIXTURE_RECEIPT"
check 'ref lookup unavailable' 2 1 "$explicit" "$ready" no-ref
check 'malformed live base' 2 1 "$explicit" "$ready" status bad-sha

started=$SECONDS
check 'both reads share the same timeout' 2 1 "$explicit" "$ready" slow-ref
[ "$((SECONDS-started))" -le 7 ]
