#!/bin/bash
# Security lint for production source files.
# Test files are excluded — they may use restricted patterns for testing.
set -euo pipefail

ERRORS=0

# 1. Ban execSync — use execFileSync or spawnSync with array args instead
VIOLATIONS=$(grep -rn "import.*execSync" src/ --include='*.ts' \
  | grep -v '\.test\.ts' \
  | grep -v 'security-regression' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ execSync imports found in production code:"
  echo "$VIOLATIONS"
  echo "   Use execFileSync or spawnSync with array args instead."
  ERRORS=$((ERRORS + 1))
fi

# 2. Ban eval() — code injection risk
VIOLATIONS=$(grep -rn '\beval(' src/ --include='*.ts' \
  | grep -v '\.test\.ts' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ eval() found in production code:"
  echo "$VIOLATIONS"
  echo "   Avoid eval — use JSON.parse, structured data, or safe alternatives."
  ERRORS=$((ERRORS + 1))
fi

# 3. Ban new Function() — equivalent to eval
VIOLATIONS=$(grep -rn 'new Function(' src/ --include='*.ts' \
  | grep -v '\.test\.ts' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ new Function() found in production code:"
  echo "$VIOLATIONS"
  echo "   Avoid dynamic code generation — use structured alternatives."
  ERRORS=$((ERRORS + 1))
fi

# 4. Ban `<writer> | grep -q` in hook scripts. Under `set -o pipefail`, grep -q
# exits at the first match, the writer gets SIGPIPE, and the pipeline reports 141.
# On input past the 64 KB pipe buffer the check then reads as "no match" and the
# hook allows a violation. Use `grep -q ... <<<"$var"` instead. A line that
# cannot hit this (file-fed writer) may carry a `# pipefail-ok` comment.
VIOLATIONS=$(grep -rnE '\|[[:space:]]*grep[[:space:]]+-[A-Za-z]*q' hooks/checks hooks/lib --include='*.sh' \
  | grep -v '\.test\.sh' \
  | grep -v 'pipefail-ok' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ '| grep -q' pipeline in hook scripts (SIGPIPE under pipefail):"
  echo "$VIOLATIONS"
  echo "   Use grep -q ... <<<\"\$var\" instead."
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "Security lint failed with $ERRORS violation(s)."
  exit 1
fi

echo "✓ Security lint: no restricted patterns in production code"
