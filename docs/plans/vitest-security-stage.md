# Vitest security patches: Stage V

## Goal and prior evidence

Registered 2026-11-02 from `fdb9b9c224e025aad69c9f872b0e17496248bc45`.
Task: `dependency-vitest-security-stage`. This is prediction only: no Stage V
baseline, updater, installation or tests have run. Read-only primary registry
and advisory metadata establish candidate compatibility, not remediation.

Goal: remove the two remaining Vitest advisory ranges through the supported
exact Vitest/coverage pair. Question: can the coupled patch remove both rows
without unrelated dependency movement or weaker installation evidence?
Metric: selected unsafe advisory/range rows 149/150, counted once per row if
any locked copy is affected. Predict 2 to 0; the original nine move from 3 to 1,
leaving only 162. The separate new ten remain unsafe 2, IDs 172/174. These
starting values are [Stage S's recorded result](development-patch-alerts.md#post-merge-fixed-status-confirmation),
not a newly executed Stage V baseline. Aggregate npm/GitHub alert counts are
informational. Original all-nine-to-zero and strict peer acceptance stay open.

## Exact candidate and protected boundary

Source preimages: package SHA256
`4351eb54ceffa7599b4d1e2bf77501f60c8e40a14b67901e866cdcdc75c58822`,
lock `adf8c01a27471bec66f466642fad471fd02d1f8ed25bca245559b9c353c0ccc4`,
and `.npmrc` `3a951f66e7e0f3e2dd1832473a871357c4a507b51100636b73bcf6ff0dd78b6c`.
Freeze protected files, all published target manifests and invocation inputs
before the first baseline. Keep raw evidence private; print fixed IDs/counts.

Permit only two root dev pins, `vitest` and `@vitest/coverage-v8`, from exact
4.1.11 to exact 4.1.12, and their mirrored lock-root declarations. The only
package records allowed to change are `node_modules/vitest` and these eight
under `node_modules/@vitest/`: `coverage-v8`, `expect`, `mocker`, `pretty-format`,
`runner`, `snapshot`, `spy`, `utils`. Each must be official 4.1.12 metadata:
version, registry URL/integrity and required linked published dependency/peer
metadata. Preserve unrelated fields; no package membership/path movement or
unrelated resolution is authorized. A blanket string replacement is invalid:
Vitest 4.1.12's optional `@vitest/browser-webdriverio` peer is **`^4.1.11`**.
Do not invent an exact 4.1.12 peer or add an absent optional browser package.

Preserve Azure, both MSAL paths, Hono/Minimatch and every other non-family
record, root declaration and optional edge. Preserve `.npmrc`, `.node-version`,
root `engines.node >=20.11.0`, the `file:scripts/stubs/jks-js` declaration and
stub bytes, and all three current overrides. Never introduce node-forge,
omit optional packages or mutate canonical/shared/sibling installations.
Vitest's published Node contract stays unchanged; the pre-existing Node 22+
development-stack requirement does not prove Node 20 development support.

Use the original plan's named lock-only npm action, pinned to qualified npm
10.9.9. Stage S's nine-scalar hand-edit permission does not apply here. Resolver
failure, unavailable metadata or movement outside this boundary stops this
approach. No hand edit, broad updater, audit fix, forced/legacy peer option,
new override, root downgrade or automatic retry is authorized. Another method
needs a separately committed registration before new outcomes.

Primary evidence: [Vitest 4.1.12](https://registry.npmjs.org/vitest/4.1.12),
[coverage-v8](https://registry.npmjs.org/@vitest%2Fcoverage-v8/4.1.12),
[mocker](https://registry.npmjs.org/@vitest%2Fmocker/4.1.12),
[149 advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp)
and [150 advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8).
The eight scoped records use the same primary registry/version path. Capture
and seal every full manifest before evaluating candidate metadata.

## Frozen query and decisions

Reuse the original nine and Stage S's new-ten rows unchanged, selecting only
149/150 for this stage's exit. Before: original `[149,150,162]`, recent
`[172,174]`, selected `[149,150]`, exit 1. After: original `[162]`, recent
`[172,174]`, selected `[]`, exit 0. Exit 2 means invalid/missing evidence,
not a clean result. Missing optional targets, invalid versions, a mixed family
or an unavailable semver import cannot produce zero unsafe permits.
Run only after this prediction is committed, identically before and after:

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const { default: semver } = await import('semver');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || pkg.engines?.node !== '>=20.11.0') throw new Error();
  const p = lock.packages;
  const family = ['vitest','@vitest/coverage-v8','@vitest/expect','@vitest/mocker','@vitest/pretty-format','@vitest/runner','@vitest/snapshot','@vitest/spy','@vitest/utils'];
  const version = pkg.devDependencies?.vitest;
  if (!['4.1.11','4.1.12'].includes(version) || pkg.devDependencies?.['@vitest/coverage-v8'] !== version ||
      family.some(name => p['node_modules/' + name]?.version !== version)) throw new Error();
  if (pkg.devDependencies?.['jks-js'] !== 'file:scripts/stubs/jks-js' ||
      JSON.stringify(pkg.overrides) !== JSON.stringify({'simple-git':'4.0.2','basic-ftp':'6.2.3','jks-js':'$jks-js'})) throw new Error();
  if (Object.keys(p).some(path => path === 'node_modules/node-forge' || path.endsWith('/node_modules/node-forge'))) throw new Error();
  for (const name of ['promptfoo','ajv','@ai-sdk/provider-utils','@azure/identity','vitest','@hono/node-server','minimatch','qs']) {
    if (!p['node_modules/' + name]) throw new Error();
  }
  const optional = p['node_modules/promptfoo'].optionalDependencies;
  if (optional?.['@azure/identity'] !== '^4.13.3' || optional?.['@azure/msal-node'] !== '^7.0.0' ||
      optional?.['@modelcontextprotocol/server-filesystem'] !== '2026.8.31') throw new Error();
  const edges = [
    ['promptfoo','undici','>=7.29.1 <8','node_modules/undici'],
    ['@ai-sdk/provider-utils','undici','^6.28.0','node_modules/@ai-sdk/provider-utils/node_modules/undici'],
    ['body-parser','qs','^6.15.2','node_modules/qs'],
    ['express','qs','^6.14.0','node_modules/qs'],
    ['googleapis-common','qs','^6.7.0','node_modules/qs'],
  ];
  for (const [parent,name,range,target] of edges) {
    if (p['node_modules/' + parent]?.dependencies?.[name] !== range ||
        !p[target] || !semver.valid(p[target].version) || !semver.satisfies(p[target].version, range)) throw new Error();
  }
  const original = [[162,'@azure/msal-node','>=5.0.0-beta.0 <7.1.0'],[161,'undici','>=7.18.0 <7.30.1'],[160,'undici','>=6.23.0 <6.29.1'],[156,'fast-uri','>=3.0.0 <3.1.9'],[155,'fast-uri','>=3.0.0 <3.1.9'],[154,'fast-uri','>=3.1.3 <3.1.9'],[153,'fast-uri','>=3.0.0 <3.1.9'],[150,'@vitest/mocker','>=2.1.0-beta.7 <4.1.12'],[149,'@vitest/mocker','>=4.1.11 <4.1.12']];
  const recent = [[174,'minimatch','<11.0.1'],[172,'@hono/node-server','>=1.19.10 <2.1.3'],[171,'undici','>=7.0.0 <7.30.1'],[170,'undici','>=7.0.0 <7.30.1'],[169,'undici','>=4.0.0 <6.29.1'],[168,'undici','>=7.0.0 <7.30.1'],[167,'undici','>=4.2.1 <6.29.1'],[166,'undici','>=7.0.0 <7.30.1'],[165,'undici','>=5.15.0 <6.29.1'],[163,'qs','>=6.7.0 <=6.16.0']];
  const selected = original.filter(([id]) => [149,150].includes(id));
  function query(rows) {
    const ids = rows.filter(([,name,range]) => {
      const copies = Object.entries(p).filter(([path]) => path === 'node_modules/' + name || path.endsWith('/node_modules/' + name));
      if (!copies.length || copies.some(([,entry]) => !semver.valid(entry.version))) throw new Error();
      return copies.some(([,entry]) => semver.satisfies(entry.version, range, {includePrerelease:true}));
    }).map(([id]) => id).sort((a,b) => a-b);
    return {cohort:rows.length, unsafe:ids.length, ids};
  }
  const result = {original:query(original), recent:query(recent), selected:query(selected)};
  console.log(JSON.stringify(result));
  process.exitCode = result.selected.unsafe ? 1 : 0;
} catch {
  console.error('vitest-stage: evidence unavailable');
  process.exitCode = 2;
}
NODE
```

## Execution and qualification

1. **Register.** Stage only this plan and its task. The source owner reviews,
   then runs `JOBS=1 heavy-run npm run verify:changed -- fdb9b9c224e025aad69c9f872b0e17496248bc45`
   and commits the prediction after zero. No package action is authorized by
   the docs gate alone. The owner accepts the actual baseline before mutation.
2. **Baseline.** Use verified Node 24.21.0 and an existing real npm 10.9.9
   executable, `STAGE_NPM10`. Bind private `STAGE_EVIDENCE_DIR`, physical roots,
   response hashes, source preimages and full stdout/stderr/exit receipts before
   comparison. Capture published 4.1.12 metadata for all nine fixed names,
   the query above, optional-inclusive audit and lock/installed tree outputs.
   The baseline must preserve the recorded selected 2/original 3/recent 2.
3. **Generate once.** Only after baseline review, run the original named pair
   action below in an owned isolated candidate. Review the complete diff and
   every required linked manifest field; do not assume a named install touches
   only those records. Reject extra keys, packages, edges or protected changes.
4. **Qualify.** Ensure task-owned real `node_modules` has no active user. Use
   the helper with this checkout as its own donor, forcing normal npm ci on the
   changed lock rather than cloning stale canonical modules. Use normal scripts
   and include optional packages. Require install exit zero, unchanged lock,
   all nine physical versions and published metadata correct, installed hidden
   lock version/URL/integrity equal source selections, and a lock-identical stamp.
   Neither a stamp nor the shallow build-guard message is this evidence.
5. **Deliver.** Integrate current main, retain the exact reviewed family diff,
   freeze source and qualified installation, and run the full uncached gate.
   Independent source/body review and normal delivery precede GitHub closure.
   No source build, app sync, canonical dependency update or native cutover is
   authorized by this preparation.

Exact baseline/post-install commands; use separate before/after filenames and
capture each exit and stderr, never `|| true`:

```sh
node --version
"${STAGE_NPM10:?}" --version
JOBS=1 heavy-run "${STAGE_NPM10:?}" audit --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/audit.json"
JOBS=1 heavy-run "${STAGE_NPM10:?}" ls --package-lock-only --all --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/locked-tree.json"
JOBS=1 heavy-run "${STAGE_NPM10:?}" ls --all --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/installed-tree.json"
JOBS=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run bash scripts/check-lockfile-sync.sh
```

The first and only proposed updater is:

```sh
JOBS=1 heavy-run npx --yes --prefer-offline --package=npm@10.9.9 -- npm install --package-lock-only --ignore-scripts --include=optional --save-dev --save-exact vitest@4.1.12 @vitest/coverage-v8@4.1.12
```

After source-diff review, the qualification and delivery commands are:

```sh
JOBS=1 heavy-run env WORKTREE_DEPS_NPM="${STAGE_NPM10:?}" npm_config_include=optional bash scripts/worktree-deps.sh "$PWD"
JOBS=1 heavy-run "${STAGE_NPM10:?}" ls --all --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/installed-tree-after.json"
JOBS=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run bash scripts/check-lockfile-sync.sh
JOBS=1 NO_CACHE=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run npm run verify
```

Repeat the frozen query and every baseline check into new receipts. Freeze
normal installation and source preimages independently; never stamp a tree by
hand or overwrite another run's installation. The pending guard/cache repair
is not a new blocker or permission to trust its current shallow receipts.

## Explicit partial acceptance and remaining work

This stage may accept only the **unchanged exact known** lock-only peer error
and installed problem evidence, following [the existing frozen comparator](dependency-install-counterfactual.md#exact-commands-to-register).
Keep lock-only exit 1 with the same Chokidar error and installed exit 1 with
all six complete problems: the five recorded optional WASM extraneous reports
plus invalid Chokidar 5.0.0. Bind the reviewed before JSON and its hash before
candidate execution. Compare sorted complete problem strings and the complete
error object (`code`, `summary`, `detail`), replacing only each exact prebound
owned physical root followed by `/`. The installed six-problem comparator is
reused unchanged. Apply that same complete-object rule to the one-problem
lock-only pair; neither allows filtering, new normalization or error suppression.
Comparator exit 0 means error equivalence only, 1 means a changed valid problem
set, and 2 means inconclusive. Any different result stops before retry or merge.
Full-graph validity remains non-green; retain the original failed receipts.

Success: selected unsafe **0/2**, original unsafe **1/9** (only 162), recent
unsafe **2/10** (172/174); no unexpected audit finding or source movement;
qualified normal install, physical/hidden-lock proof, pinned lock sync and
uncached required gate pass; then both GitHub rows report `fixed` with non-null
timestamps. These are conjunctive requirements, not interchangeable metrics.
Pivot on any unsafe selected copy, missing evidence, changed problem/error
object, protected delta, resolver failure, unrelated resolution or gate failure.
Do not close `dependency-alert-remediation` or `dependency-peer-compatibility`:
the original all-nine-to-zero and strict full-graph requirements remain intact.

After normal merge only, verify exact selected IDs; dismissal or delayed/missing
API data is not fixed-status proof:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh api --paginate --slurp 'repos/fyodoriv/agentbrew/dependabot/alerts?per_page=100' > "${STAGE_EVIDENCE_DIR:?}/alerts-after.json"
jq -e '[.[][] | select(.number as $n | [149,150] | index($n))] | sort_by(.number) | map(.number) == [149,150] and all(.[]; .state == "fixed" and .fixed_at != null)' "${STAGE_EVIDENCE_DIR:?}/alerts-after.json"
```

Anchors: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration; upstream advisories above and npm's supported
[install](https://docs.npmjs.com/cli/v10/commands/npm-install/),
[lockfile](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/) and
[clean-install](https://docs.npmjs.com/cli/v10/commands/npm-ci/) contracts.
