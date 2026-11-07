#!/bin/bash
set -euo pipefail
log=$(mktemp)
trap 'rm -f "$log"' EXIT
node --test --test-reporter=tap scripts/chat-schema-runner-gate.test.mjs | tee "$log"
node scripts/chat-rule-tap.mjs "$log" --runner-gate
node --test --test-reporter=tap scripts/chat-schema-runner.test.mjs | tee "$log"
node scripts/chat-rule-tap.mjs "$log" --runner
