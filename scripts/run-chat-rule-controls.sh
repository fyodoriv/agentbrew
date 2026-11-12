#!/bin/bash
set -euo pipefail
log=$(mktemp)
trap 'rm -f "$log"' EXIT
node --test --test-reporter=tap scripts/chat-rule-gate.test.mjs | tee "$log"
grep -Fxq '# tests 5' "$log" && grep -Fxq '# pass 5' "$log" && grep -Fxq '# fail 0' "$log" && grep -Fxq '# cancelled 0' "$log" && grep -Fxq '# skipped 0' "$log" && grep -Fxq '# todo 0' "$log" || exit 1
for name in 'default gate includes chat rule controls' 'accepts complete 16-case report' 'rejects missing or duplicate cases' 'rejects skipped or todo cases' 'rejects forged passing summary'; do
  grep -Eq "^ok [0-9]+ - $name$" "$log"
done
node --test --test-reporter=tap scripts/eval-chat-message-rule-821.test.mjs | tee "$log"
node scripts/chat-rule-tap.mjs "$log"
