#!/bin/bash
set -euo pipefail
log=$(mktemp)
trap 'rm -f "$log"' EXIT
node --test --test-reporter=tap scripts/chat-rule-schema-gate.test.mjs | tee "$log"
node scripts/chat-rule-tap.mjs "$log" --schema-gate
node --test --test-reporter=tap scripts/chat-rule-schema-protocol.test.mjs | tee "$log"
node scripts/chat-rule-tap.mjs "$log" --schema
