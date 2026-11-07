# Lifecycle recorder: pure preparation transfer

Draft #819 contains a reviewed pure recorder and nine synthetic health tests,
but its separate process-group runner is unqualified. Do not copy or execute
that runner. Transfer only the two byte-identical files from draft head
`745528914a8011bb50ad608680b038d2a902c00d` to a clean current-main branch:

- `src/plugins/lifecycle-observation.ts`: SHA-256
  `a6b1b361386d15741720df6516b9483d9caf99a4c9a3d2a701b12d3d72d68a3c`.
- `src/plugins/lifecycle-recorder-health.test.ts`: SHA-256
  `888e881eee65c801cb4fdfbbb0a77ab643d8909014ebea372d1ab62dbe071db4`.

The immutable [draft plan at its reviewed head](https://github.com/fyodoriv/agentbrew/blob/745528914a8011bb50ad608680b038d2a902c00d/docs/plans/plugin-lifecycle-timeout-observation.md)
records the named red and green before this transfer. Include this link and
the historical evidence limits in the delivered plan and PR. Goal: retain those pure controls on current main. Predict all nine
registered cases pass with no skips and no child process or signal launched by
the recorder or test code. Vitest may launch its own worker. Measurement:

```sh
bash <<'BASH'
set -eu
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/plugins/lifecycle-recorder-health.test.ts --maxWorkers=1 --reporter=json --outputFile="$logs/results.json"
node - "$logs/results.json" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cases = report.testResults.flatMap(f => f.assertionResults);
const expected = ['recorder health signals primary failure', 'recorder health survives both sinks failing', 'recorder health preserves action identity', 'recorder health accepts complete stage', 'recorder health leaves pending stage incomplete', 'throwing initial clock remains unqualified', 'throwing terminal clock remains unqualified', 'throwing failure clock preserves action', 'reentrant health stays pending'];
if (!report.success || report.testResults.length !== 1 || cases.length !== 9 || cases.some(c => c.status !== 'passed') || new Set(cases.map(c => c.title)).size !== 9 || expected.some(name => !cases.some(c => c.title === name))) process.exit(1);
console.log('lifecycle recorder: nine named controls passed');
NODE
BASH
```

Success requires all nine named cases, the exact two source hashes, no change
to `src/plugins/cli-plugin.test.ts` and no imported draft fixture, plus the
ordinary uncached full repository gate and independent exact-head review.
Before that gate confirm the rejected controlled source-lease describe is
absent, the unqualified group-signal runner is absent from the whole composed tree,
and normal default discovery is unchanged except for the new pure test. The
ordinary existing lifecycle and natural lease controls remain the normal gate;
these results are not additional admissions to closed research cohorts.

Pivot if a control fails, a source hash differs, an unsafe runner enters the
composed tree, or the full gate regresses. Retain the earlier draft and its
failed or unqualified evidence. This transfer is preparation only: external
recorder health, process-group ownership, the original timeout cause and the
real lifecycle diagnosis remain unqualified. Do not close the existing task
or claim an observed runtime improvement.

Anchors: draft #819's registered recorder controls and Basili, Caldiera and
Rombach (1994), Goal Question Metric.

Observed after registration: the exact focused JSON oracle passed all nine
named cases. This does not qualify the untransferred process-group runner or
attribute the earlier timeout.
