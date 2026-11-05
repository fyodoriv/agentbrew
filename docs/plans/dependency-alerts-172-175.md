# New dependency alerts 172 and 175: blocked preparation

## Scope and evidence

Record two new alerts without changing the original nine-row
[dependency experiment](dependency-alert-controls.md). MSAL alert 162 stays
there. This is task preparation from read-only source and primary metadata,
not an installation, audit, successful baseline or implementation result.

Source checked on November 5, 2026: main
`b4f379f330226d4fd49d4818ccf09e7659410d7d`. Recheck the current source and
published metadata before choosing a candidate.

| Alert | Package | Frozen affected range | First fixed version | Primary evidence |
| --- | --- | --- | --- | --- |
| 172 | `@hono/node-server` | `>=1.19.10 <2.1.3` | 2.1.3 | [GitHub advisory API](https://api.github.com/advisories/GHSA-rmxm-3fg6-px4f) |
| 175 | `minimatch` | `>=7.0.0 <11.0.1` | 11.0.1 | [GitHub advisory API](https://api.github.com/advisories/GHSA-g3hv-75wg-m249) |

The normalized minimatch advisory was updated on November 4, 2026. Its API
range covers 7.x through 10.x; do not narrow it to the version displayed in
the issuer's older prose. Count each row unsafe if any matching locked copy
is affected. These two rows do not replace the original nine-row denominator.

## Current parent constraints

- Hono: the lock has safe root 2.1.4 and vulnerable 2.1.1 nested under
  Promptfoo. [Promptfoo 0.124.1](https://registry.npmjs.org/promptfoo/0.124.1)
  pins 2.1.1. [0.125.0](https://registry.npmjs.org/promptfoo/0.125.0) and
  [0.125.1](https://registry.npmjs.org/promptfoo/0.125.1) pin fixed 2.1.5,
  but introduce optional peer `jks-js: ^1.1.5`. The protected local stub
  is `0.0.0-agentbrew-stub`; optional does not make an incompatible present
  peer valid.
- Minimatch: locked 10.2.5 is required through Promptfoo `^10.2.4`,
  [Glob 13.0.6](https://registry.npmjs.org/glob/13.0.6) `^10.2.2` and
  [filesystem 2026.8.31](https://registry.npmjs.org/@modelcontextprotocol%2Fserver-filesystem/2026.8.31)
  `^10.0.1`. Latest Promptfoo retains these major ranges and its exact
  filesystem pin. [Glob 14.0.3](https://registry.npmjs.org/glob/14.0.3)
  supports `^11.0.2`, but is outside the parents' Glob 13 range.
  [Filesystem 2.2.0](https://registry.npmjs.org/@modelcontextprotocol%2Fserver-filesystem/2.2.0)
  supports `^11.0.4`, but is outside the pin and requires Node >=24.
- Current and latest Promptfoo retain Chokidar 5.0.0 and Nunjucks `^3.2.4`.
  [Nunjucks 3.2.4](https://registry.npmjs.org/nunjucks/3.2.4) requires optional
  peer Chokidar `^3.3.0`. The existing
  [peer compatibility task](dependency-alert-controls.md#exact-constraint-and-source-limit)
  remains a full-graph acceptance blocker.

No checked supported parent path removes both new ranges while preserving
these contracts. This is a dated metadata conclusion, not proof that no
future upstream fix can exist. Do not force a transitive major override.

Preserve the local `file:scripts/stubs/jks-js` declaration and stub bytes,
`simple-git: 4.0.2`, `basic-ftp: 6.2.3`, `jks-js: $jks-js`, optional
paths, the root Node floor and `.node-version`. Do not introduce node-forge,
downgrade root Chokidar, dismiss alerts or hide invalid edges. A proposed
broader policy change needs separate approval and a new prediction.

## Next experiment: proposed commands, not a passing harness

1. Recheck primary metadata. Once a supported parent contract exists, commit
   its exact versions, source hashes, hypothesis and commands before package,
   installation or audit changes. Root owns that implementation and delivery.
2. Freeze a task-owned checkout and qualified independent installation. Keep
   canonical dependencies unchanged. Predict unsafe rows 2 -> 0, invalid or
   missing full-tree edges -> 0, and zero new unresolved findings or protected
   changes. Pivot on any violation; unavailable evidence is inconclusive.
3. Run this proposed exact lock query before and after the registered change:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import semver from 'semver';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const rows = [
  [172, '@hono/node-server', '>=1.19.10 <2.1.3'],
  [175, 'minimatch', '>=7.0.0 <11.0.1'],
].map(([alert, name, range]) => {
  const copies = Object.entries(lock.packages ?? {})
    .filter(([path]) => path.endsWith(`node_modules/${name}`));
  if (!copies.length || copies.some(([, p]) => !semver.valid(p.version)))
    throw new Error(`missing or invalid package evidence for alert ${alert}`);
  return { alert, unsafe: copies.some(([, p]) =>
    semver.satisfies(p.version, range, { includePrerelease: true })) };
});
console.log(JSON.stringify({ rows, unsafeRows: rows.filter(r => r.unsafe).length }));
JS
```

4. Register the exact task-owned normal installation command and supported
   npm 10 executable before running it. Preserve the full optional graph.
   Proposed verification commands below are not results or a substitute for
   that installation. Run them through the shared queue and retain exit codes:

```sh
JOBS=1 heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --package-lock-only --all --include=optional --json
JOBS=1 heavy-run npx --yes --prefer-offline --package=npm@10 -- npm audit --include=optional --json
bash scripts/check-lockfile-sync.sh
JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

5. After reviewed delivery, require both default-branch alerts to be fixed
   with nonempty timestamps. Proposed read-only query:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh api repos/fyodoriv/agentbrew/dependabot/alerts/172 --jq '{number,state,fixed_at}'
env -u GH_TOKEN -u GITHUB_TOKEN gh api repos/fyodoriv/agentbrew/dependabot/alerts/175 --jq '{number,state,fixed_at}'
```

Keep the task open until every acceptance condition holds. Preparation, a
single fixed copy, runtime-only auditing and missing service data do not
establish completion. GQM and preregistration anchors follow the original
[registered experiment](dependency-alert-controls.md#boundary-and-measurement-contracts).
