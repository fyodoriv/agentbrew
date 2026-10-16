#!/usr/bin/env bash
# Run the regression evals. CHECK_EVALS=1 scripts/check.sh calls this file.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f evals/promptfooconfig.yaml ]; then
  exec npx -y promptfoo@latest eval -c evals/promptfooconfig.yaml
fi
echo "FILL: wire evals/run.sh to your eval runner (see evals/README.md)" >&2
exit 1
