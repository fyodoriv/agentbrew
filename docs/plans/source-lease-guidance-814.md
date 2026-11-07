# Source lease guidance: issue 814

Goal: make a busy source checkout identifiable without weakening its lease.
Question: do both existing refusal paths identify the same checkout for a
person who needs to investigate? Predict identifiable refusals rise from 0/2
to 2/2. Both synthetic owner records must stay byte-for-byte unchanged, and
zero work callbacks may run. This slice does not release a lease.

Register before adding the control. Build only private scratch HOME and
checkout fixtures. Set HOME before importing the lease module and assert that
its resolved home is the scratch directory. Create one private lease at the
real SHA-256 path derived from the exported checkout key, containing a
synthetic owner record with a unique private token. No real lease, process,
signal, Git child, network or user data may be used. Use a controlled clock
for the async wait, and restore it and HOME after each test.

Add exactly two named controls in `src/catalog/source-lease-guidance.test.ts`:
`sync busy checkout guidance` and `async busy checkout guidance`. Each
checks a refusal with the expected 12-character digest, no token or owner
contents in output, zero work calls and unchanged owner bytes. Check the
asynchronous path reaches its real busy deadline. A setup error, accepted
work, different refusal or missing test is inconclusive, not a red result.
Before changing production code, the two named assertions must fail solely
because the busy message lacks that digest; preserve their terminal output.

For both red and green runs, the shell creates a fresh private scratch HOME.
The normal Vitest setup then creates its own per-file scratch HOME; the test
must verify the effective `homedir()` is that scratch home, not the owner
home, before any lease write or cleanup. Run this exact command with `red`
before production changes and `green` afterward. The red diagnostics are
fixed assertion messages `missing sync checkout digest` and
`missing async checkout digest`:

```sh
bash <<'BASH'
set -o pipefail
mode=${LEASE_EXPECT:?set LEASE_EXPECT to red or green}
case "$mode" in red|green) ;; *) exit 2 ;; esac
root=$(mktemp -d) || exit 2
trap 'rm -rf "$root"' EXIT
mkdir -m 700 "$root/home" || exit 2
HOME="$root/home" JOBS=1 heavy-run npm exec -- vitest run src/catalog/source-lease-guidance.test.ts --maxWorkers=1 --reporter=json --outputFile="$root/report.json"
status=$?
node - "$root/report.json" "$mode" "$status" <<'NODE'
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[3], exit = Number(process.argv[4]);
const tests = r.testResults.flatMap((f) => f.assertionResults);
const cases = [['sync busy checkout guidance', 'missing sync checkout digest'], ['async busy checkout guidance', 'missing async checkout digest']];
if (r.numTotalTests !== 2 || tests.length !== 2 || r.numPendingTests !== 0 || r.numTodoTests !== 0) process.exit(1);
for (const [name, diagnostic] of cases) {
  const hits = tests.filter((t) => t.fullName === `source lease refusal guidance ${name}`);
  if (hits.length !== 1) process.exit(1);
  const t = hits[0];
  if (mode === 'green' ? t.status !== 'passed' : t.status !== 'failed' || !t.failureMessages.some((m) => m.includes(diagnostic))) process.exit(1);
}
if (mode === 'green' ? exit !== 0 || !r.success || r.numPassedTests !== 2 : exit !== 1 || r.success || r.numFailedTests !== 2) process.exit(1);
console.log(`${mode}: both named controls observed`);
NODE
BASH
```

Run the existing lease suite with a separately created scratch `HOME` at the
process boundary as well; its teardown removes its effective lease root.
Verify the normal isolated-home setup before any fixture executes. The final
ordinary full gate runs in a clean independent worktree where the controlled
physical research describe is absent. Do not run it in the restricted
research checkout or repeat closed cohort admissions.

After the change require 2/2 named passes, 2/2 unchanged owner records and
zero callbacks or token disclosures. Run existing lease tests, type and lint
checks, independent review and the ordinary full gate on the final tree.
Any missing identifier, altered lease, callback, secret disclosure or safety
regression rejects this approach. The guide must say that another refresh
may still be active, that a dead PID does not prove all Git work stopped,
and that the lease stays when ownership and work cannot be independently verified.
It must not instruct automatic removal or claim the earlier incident's cause.

Anchor: current lease acquisition and retained-child contracts; Basili,
Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017),
preregistration. Closed physical research cohorts are not used.

The first red command was inconclusive: `endsWith` matched the sync name
against the async name too. The exact-name correction above preserves both
registered controls and thresholds. A diagnostic run showed the two intended
missing-digest failures; it does not replace the corrected red command.

The corrected red command observed both missing-digest failures. After the
change, both named controls passed with unchanged synthetic owner records and
no work callbacks or owner output. The existing lease suite passed 16 tests
with an isolated home. These results do not qualify stale-lease removal.
