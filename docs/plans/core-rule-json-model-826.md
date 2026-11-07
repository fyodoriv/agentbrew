# Core-rule dispatch: JSON-bound model pivot

The first single-dispatcher model was rejected: sparse JavaScript arrays
passed its validation. Preserve that source and the focused failure. This
distinct test-only design accepts JSON text, parses it, requires an exact
`JSON.stringify` round trip, and validates its shape with the already-used
Ajv 2020 schema library before selecting IDs. JSON has no sparse array holes;
a serialized hole becomes `null`, which the schema must reject. The exact
round trip rejects duplicate object keys, whitespace and other noncanonical
spellings. This is exactly JavaScript `JSON.stringify` output, not a general
canonical-JSON standard or a promise to accept all valid JSON. Configure Ajv
with coercion, defaults and removal of additional properties disabled. This
conservative model does not read real settings or prove a
trusted enabled-plugin snapshot, hook migration, or delivery.

Goal: reject malformed snapshot evidence before modeled selection. Predict
11/11 fixed synthetic controls pass with zero false selections, duplicate IDs,
input mutation, process or network calls. The function accepts only a string
of at most 64 KiB UTF-8. The static schema requires exactly these fields:
nonblank string `session`, booleans `trusted`, `complete`, `legacy`, and
`completed`, integer `dispatchers`, a `known` array of nonblank string IDs,
and a `plugins` array of records with nonblank string `id`, boolean `enabled`
and `eligible`, and an array of nonblank string `rules`. Reject additional or
missing fields, duplicate plugin IDs, invalid JSON, noncanonical input and
schema errors. After validation, return `unqualified` unless trusted and
complete are true, exactly one dispatcher is modeled, legacy is false and
completed is true. For enabled eligible plugins, an ID absent from `known`
is unqualified. Otherwise return a sorted unique ID list; an empty list is a
modeled selection, not a claim of delivery.

Before implementing the helper create
`src/plugins/core-rule-json-model.test.ts` with these exact named controls:
`two eligible share rule`, `disabled former owner`, `all disabled`, `separate
sessions`, `missing session`, `untrusted snapshot`, `legacy coexistence`,
`dispatcher failure`, `unknown eligible rule`, `conflicting plugin ids`,
and `malformed json`. They cover the same ten behavioral cases as the earlier
plan plus raw duplicate-key JSON, noncanonical whitespace, invalid JSON,
oversize input and JSON null array entries representing sparse holes. The
negative cases include wrong field types, absent fields, zero/two dispatchers,
invalid plugin IDs, additional fields, duplicate plugin IDs and malformed
known or rule arrays. Put null holes in both `known` and the `rules` of a
disabled or ineligible plugin; those inputs must be unqualified. Freeze and compare
inputs; output is only a modeled selection or `unqualified`. There is no file,
settings, agent, process or network access by the helper. Source review is the
evidence for that absence, not a measured sandbox claim.

The first case must fail against a test-only placeholder with the fixed
diagnostic `json dispatcher placeholder`. Use the exact red and green JSON
oracles below. A failure report from the green run stays private. Success
requires exactly 11/11 named passes, zero false selections, no missing or
skipped tests and independent review. Any malformed input accepted, duplicate
selected ID, false modeled success or input mutation rejects this approach.
Gate discovery, effective settings, live hooks and delivery need separate
registration and proof before any production change can merge.

```sh
bash <<'BASH'
receipt=$(mktemp) || exit 2
trap 'rm -f "$receipt"' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/plugins/core-rule-json-model.test.ts --maxWorkers=1 -t 'two eligible share rule' --reporter=json --outputFile="$receipt" >/dev/null 2>&1
result=$?
[ "$result" -ne 0 ] || exit 2
node - "$receipt" <<'NODE'
const d = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
const t = d.testResults.flatMap(x => x.assertionResults).filter(x => x.title === 'two eligible share rule');
if (t.length !== 1 || t[0].status !== 'failed' || !(t[0].failureMessages || []).join('\n').includes('json dispatcher placeholder')) process.exit(2);
NODE
BASH
```

```sh
bash <<'BASH'
umask 077
receipt=$(mktemp) || exit 2
trap 'result=$?; if [ "$result" -eq 0 ]; then rm -f "$receipt"; else printf "failed report retained: %s\n" "$receipt" >&2; fi' EXIT
JOBS=1 heavy-run npm exec -- vitest run src/plugins/core-rule-json-model.test.ts --maxWorkers=1 --reporter=json --outputFile="$receipt" >/dev/null 2>&1 || exit 1
node - "$receipt" <<'NODE'
const d = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
const expected = ['two eligible share rule', 'disabled former owner', 'all disabled', 'separate sessions', 'missing session', 'untrusted snapshot', 'legacy coexistence', 'dispatcher failure', 'unknown eligible rule', 'conflicting plugin ids', 'malformed json'];
const results = d.testResults.flatMap(x => x.assertionResults);
if (!d.success || d.numPassedTests !== 11 || d.numFailedTests !== 0 || d.numPendingTests !== 0 || results.length !== 11) process.exit(2);
for (const name of expected) { const rows = results.filter(x => x.title === name); if (rows.length !== 1 || rows[0].status !== 'passed') process.exit(2); }
NODE
BASH
```

Anchors: the rejected sparse-array control and existing Ajv use in plugin
manifest validation; Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration.

The first red command was inconclusive: its checkout had no `node_modules`, so
Vitest could not load `vitest/config` and the JSON report was empty. The
diagnostic is preserved at `/tmp/core-json-model-red-diagnostic.log`. This is
not the registered placeholder failure and is not model evidence. Keep the
unmodified placeholder and plan in that checkout. Repeat the same registered
red in a clean task-owned checkout with existing dependencies, after checking
its source and dependency identity; do not install or alter canonical
dependencies for the experiment.
