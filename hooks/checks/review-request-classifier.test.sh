#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
test_file="$script_dir/../lib/review-request-classifier-test.py"
command -v python3 >/dev/null 2>&1 || exit 1
[ -f "$test_file" ] || exit 1
log=$(mktemp) || exit 1
trap 'rm -f "$log"' EXIT
python3 "$test_file" -v >"$log" 2>&1 || { cat "$log"; exit 1; }
[ -f "$log" ] || exit 1
names='positive_separate positive_equals view remove assignee quoted_body compound expansion empty unknown_flag'
for name in $names; do
  pattern="^test_$name \\(__main__\\.ReviewRequestTests(\\.test_$name)?\\) \\.\\.\\. ok$"
  [ "$(grep -Ec "$pattern" "$log")" -eq 1 ] || exit 1
done
[ "$(grep -Ec '^test_.* \.\.\. ok$' "$log")" -eq 10 ] || exit 1
[ "$(grep -Ec '^test_.* \.\.\. ' "$log")" -eq 10 ] || exit 1
[ "$(grep -Ec '^Ran [0-9]+ tests? in ' "$log")" -eq 1 ] || exit 1
grep -Eq '^Ran 10 tests in ' "$log" || exit 1
[ "$(grep -Fxc 'OK' "$log")" -eq 1 ] || exit 1
if grep -Eiq 'skipped|unexpected success|expected failure|^FAILED|^ERROR|^FAIL' "$log"; then exit 1; fi
printf 'review request classifier: 10 passed\n'
