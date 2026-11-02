# Development dependency patches: Stage S

## Goal, decision and evidence

Registered 2026-11-02 from `44c085d1324485dccd087721e66da324d346b987`.
Task: `dependency-development-patches`. Reduce vulnerable development dependency
rows with supported leaf patches. This prediction was committed before the
baseline and package actions. Read-only advisory and registry inspection was
not its baseline. The dated result below is separate from the prediction.
This advances G5: verifiable configuration and runtime health.

Select three exact published leaf versions within every existing parent range.
This stage explicitly revises the method in
[the original plan](dependency-alert-controls.md#c-minimal-package-manager-actions-only-after-valid-baseline):
its prohibition on hand-editing lock/integrity fields is superseded **for
Stage S only**, before measurement, by the guarded nine-scalar edit below.
The original nine-alert acceptance, completed Stage R runtime cohort and all
prior failed evidence remain unchanged. This does not waive peer validity.

An unrestricted npm update can select qs 6.17.1 instead of the chosen patch.
A new root dependency, major override or dependency resolver is unnecessary.
Reuse published npm metadata, normal npm 10 installation and existing gates.

| Claim | Source of truth | Status |
| --- | --- | --- |
| Undici parents accept both fixed patches | Promptfoo `>=7.29.1 <8`; provider-utils `^6.28.0` in the frozen lock | fact |
| qs parents accept 6.16.1 | body-parser `^6.15.2`, Express `^6.14.0`, googleapis-common `^6.7.0` | fact |
| Hono remains pinned; Minimatch remains on an incompatible major range | Promptfoo's Hono 2.1.1 and the locked `^10` Minimatch parents | fact |
| Three patches remove the selected advisory ranges | Frozen query and normal installation below | proposed |
| Full graph remains unsupported | Existing Nunjucks/Chokidar peer and unchanged-lock installation control | fact |

## Frozen cohorts and decision

Count an advisory/range row unsafe if **any** matching locked copy is affected,
including optional/development copies. These are separate denominators:

- Original nine: 162/161/160/156/155/154/153/150/149. Predicted unsafe 5 to 3,
  leaving 162/150/149. Its final nine-to-zero requirement stays open.
- New ten: 174/172/171/170/169/168/167/166/165/163. Predicted unsafe 10 to 2,
  leaving 174/172. Do not omit either blocked row.
- Selected ten: 171/170/169/168/167/166/165/163 plus old 161/160.
  Predicted unsafe 10 to 0. This is partial delivery only.

The open-alert aggregate 15 to 5 is informational, not an acceptance metric.
The query returns 1 while selected rows remain, 0 when they are absent, and 2
for missing/invalid evidence. Success also requires the exact protected diff,
qualified installation, unchanged known peer-error evidence and all required
repository gates. Pivot on any selected unsafe row, extra lock movement,
missing optional/registry evidence, changed protected contract, new tree error
or gate regression. Never call the full graph green while its peer error
persists. Do not close the original remediation or peer tasks from this stage.

Primary advisories: [Undici 7 fixes](https://github.com/nodejs/undici/releases/tag/v7.30.1),
[Undici 6 fixes](https://github.com/nodejs/undici/releases/tag/v6.29.1),
[qs](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw),
[Minimatch](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249),
[Hono](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f).
Anchors: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò
et al. (2017), preregistration; npm's
[lockfile](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/)
and [clean-install](https://docs.npmjs.com/cli/v10/commands/npm-ci/) contracts.

## Exact candidate and protected inputs

The only allowed changes are `version`, `resolved` and `integrity` in each
record below: exactly nine scalar paths. Package membership, dependency and
optional edges, root declarations and every other record field stay identical.

| Lock package path | Before | After | Primary metadata |
| --- | --- | --- | --- |
| `node_modules/undici` | 7.30.0 | 7.30.1 | https://registry.npmjs.org/undici/7.30.1 |
| `node_modules/@ai-sdk/provider-utils/node_modules/undici` | 6.29.0 | 6.29.1 | https://registry.npmjs.org/undici/6.29.1 |
| `node_modules/qs` | 6.16.0 | 6.16.1 | https://registry.npmjs.org/qs/6.16.1 |

Resolved URLs are respectively
`https://registry.npmjs.org/undici/-/undici-7.30.1.tgz`,
`https://registry.npmjs.org/undici/-/undici-6.29.1.tgz`, and
`https://registry.npmjs.org/qs/-/qs-6.16.1.tgz`. Frozen published SRI values:

```text
7.30.1 sha512-03KrMbjIFDWQR5RNPrSw3bd1r12JpyFQl9/yxjUbJtqkjmllqC5lFjZh6ujeuJCKr8EOQvRW872Oy/az+nLYxg==
6.29.1 sha512-EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA==
6.16.1 sha512-5Px6J7rfHBAGUhNQ3es4YzcOdBBw0SDcVtThJml4RdnKw4tKs2epA0kPZ+K8X+WiHktT93RHVcQ/3ym5aTCgtg==
```

Recheck these public metadata bindings before editing; mismatch is unknown,
not permission to select another version. Both Undici versions have no package
dependencies. qs retains `side-channel: ^1.1.1` and
`es-define-property: ^1.0.1`. Engines remain `>=20.18.1`, `>=18.17` and
`>=0.6`, respectively. The pre-existing Undici 7 transitive floor exceeds the
root's minimum; this patch neither raises nor resolves that existing mismatch.

Require these SHA256 preimages; all except the lock remain identical afterward:

```text
package-lock.json cbd39f323bdf178b0ab5310ac81ba4e46945360a7957d6d3f15390eee00f0303
package.json 4351eb54ceffa7599b4d1e2bf77501f60c8e40a14b67901e866cdcdc75c58822
.npmrc 3a951f66e7e0f3e2dd1832473a871357c4a507b51100636b73bcf6ff0dd78b6c
.node-version f14b4987904bcb5814e4459a057ed4d20f58a633152288a761214dcd28780b56
scripts/stubs/jks-js/package.json ade825c49b03355e02711f858aef95bf7f27cc67b0673930e487e366cb91fc4d
scripts/stubs/jks-js/index.js 035ff6b5c1ad8d9325a4fceea6ad80cad89e091070e4384d700dbd98ff5da8b2
```

Keep Node `>=20.11.0`, optional graph, local jks stub and overrides
`simple-git: 4.0.2`, `basic-ftp: 6.2.3`, `jks-js: $jks-js` unchanged.
Never introduce node-forge, force peers, prune errors or modify canonical,
shared or sibling dependencies. No production code or new measurement engine.

## Frozen lock query

After the prediction commit only, run this unchanged before and after editing.
Save stdout and its actual exit in an invocation-owned private evidence folder.
This uses the already declared `semver` dependency and the original plan's
locked-copy projection. No npm audit aggregate replaces its denominators.

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const { default: semver } = await import('semver');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || pkg.engines?.node !== '>=20.11.0') throw new Error();
  const p = lock.packages;
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
  const selected = [...recent.filter(([id]) => ![174,172].includes(id)), ...original.filter(([id]) => [161,160].includes(id))];
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
  console.error('development-patches: evidence unavailable');
  process.exitCode = 2;
}
NODE
```

Expected before: original unsafe `[149,150,160,161,162]`; recent unsafe all ten;
selected unsafe all ten. Expected after: original `[149,150,162]`, recent
`[172,174]`, selected `[]`. Preserve the original query in its plan unchanged.

## Numbered execution and qualification

1. **Register.** Owner: source orchestrator. Why: freeze prediction before
   results. Stage only this plan and its task. Verify with
   `JOBS=1 heavy-run npm run verify:changed -- 44c085d1324485dccd087721e66da324d346b987`;
   commit the docs only after zero. No package actions during this step.
2. **Baseline.** Depends on 1; owner: task-owned checkout. Run the frozen query,
   then the commands below with Node 24.21.0 and verified npm 10.9.9. Preserve
   actual exits, full JSON, protected hashes and the known peer errors. Missing
   setup, optional data or registry response is inconclusive. The source owner
   reads the baseline before authorizing any edit.
3. **Patch.** Depends on accepted baseline; owner: source orchestrator. Check
   the whole-lock preimage and all protected hashes. Parse a copy, replace only
   the nine listed scalars with the frozen values, and assert each value really
   changed. Restore those nine original scalar values in a second candidate
   copy: its complete parsed JSON must equal the original. Reject any other
   field/key/edge difference. Preserve raw before/after and exact diff. Recheck
   parent ranges and published metadata; no resolver or integrity fabrication.
4. **Qualify.** Depends on reviewed patch. First verify the selected
   `node_modules` is regular, task-owned and unused by another run. Use the
   existing helper with **this checkout itself** as donor argument, so a changed
   stamp forces normal npm ci rather than cloning stale canonical dependencies.
   `STAGE_NPM10` is an existing verified executable forwarding all arguments to
   npm 10.9.9 with the approved Node, not a simulated installer. Preserve owner
   HOME, routing and registry configuration. Inspect its identity/version first.
5. **Deliver.** Depends on qualification and independent review. Update README
   with the partial result, integrate current main, freeze actual source, run
   the full uncached gate, then normal source delivery. Confirm all selected
   GitHub rows fixed afterward. No app installation, broad sync or service work.

Baseline and post-install commands (each heavy command uses canonical queue
admission; keep one inner worker, no slot/cap override):

```sh
node --version
"${STAGE_NPM10:?}" --version
JOBS=1 heavy-run "${STAGE_NPM10:?}" ls --package-lock-only --all --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/locked-tree.json"
JOBS=1 heavy-run "${STAGE_NPM10:?}" audit --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/audit.json"
JOBS=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run bash scripts/check-lockfile-sync.sh
```

After authorization and the guarded patch, install once; never overwrite a
running or unowned installation. Require actual version lines v24.21.0/10.9.9,
unchanged candidate lock and a matching helper stamp after success:

```sh
JOBS=1 heavy-run env WORKTREE_DEPS_NPM="${STAGE_NPM10:?}" npm_config_include=optional bash scripts/worktree-deps.sh "$PWD"
JOBS=1 heavy-run "${STAGE_NPM10:?}" ls --all --include=optional --json > "${STAGE_EVIDENCE_DIR:?}/installed-tree.json"
JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

Repeat the frozen query and baseline commands into separately named after
receipts. Compare each target's physical package.json version, dependencies,
optionalDependencies, peerDependencies, engines, license and funding with its
frozen published manifest. Compare its installed hidden-lock version, resolved
URL and integrity with the selected source-lock record. Do not use the shallow
build guard's text as that readback. Normal npm ci verifies downloaded archive
integrity. A stamp alone is not installed-tree proof. Preserve the full
installed-tree nonzero evidence.

Reuse the [unchanged-lock control](dependency-install-counterfactual.md): the
approved npm 10 control established the five optional WASM extraneous reports
plus the Chokidar invalid report on the unchanged lock. Compare the complete
problem set and error object, normalizing only the prebound owned physical
prefix as its comparator prescribes. Do not filter problems, downgrade peers,
accept new problems or repeat a failed install automatically. The lock-only
peer conflict also stays explicitly non-green. The completed control explains
that earlier error-equivalence result, not the mechanism or full-graph safety.
Any different error requires a separately registered diagnostic before retry.

After normal merge, preserve all original fixed-status requirements and run:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh api --paginate --slurp 'repos/fyodoriv/agentbrew/dependabot/alerts?per_page=100' > "${STAGE_EVIDENCE_DIR:?}/alerts.json"
jq -e '[.[][] | select(.number as $n | [160,161,163,165,166,167,168,169,170,171] | index($n))] | sort_by(.number) | map(.number) == [160,161,163,165,166,167,168,169,170,171] and all(.[]; .state == "fixed" and .fixed_at != null)' "${STAGE_EVIDENCE_DIR:?}/alerts.json"
```

Unknown API state, dismissal and a missing row are not fixed status. The new
cohort's Hono and Minimatch rows and original MSAL/mocker rows stay tracked.

## Recorded partial result

2026-11-02: prediction commit `8f376b430b8f5b37dac5fcabab1a7062c465fc26`
preceded the baseline and patch. The same frozen query returned these actual
results, counting every locked copy and retaining all denominators:

| Cohort | Baseline unsafe | Candidate unsafe | Remaining IDs |
| --- | --- | --- | --- |
| Original nine | 5 | 3 | 149/150/162 |
| New ten | 10 | 2 | 172/174 |
| Selected ten | 10 | 0 | none |

The baseline query exited 1; the candidate and post-install queries exited 0.
Only the nine registered scalars changed. Restoring their original values
recovered the complete original parsed JSON and bytes. All other package
records, dependency edges, protected source hashes and canonical dependency
samples remained unchanged.

The first normal self-donor installation completed with exit 0, Node 24.21.0
and npm 10.9.9. The installed physical manifests for both Undici copies and qs
matched the published version, dependency, optional, peer, engine, license and
funding fields. Their nine hidden-lock version/URL/integrity fields matched
the selected source lock. The helper stamp matched the candidate lock.
Pinned npm 10.9.9 lock validation passed.

The optional-inclusive audit remained a valid nonzero response because other
findings remain. The selected advisory identifiers were absent; no new advisory
identifier appeared against this baseline. Its aggregate package count did
not replace the frozen advisory/range metrics.

Full-graph validation is still **non-green**. The lock-only tree retained the
same Chokidar peer problem and complete error object. The installed tree had
the same six problems as the prebound unchanged-lock control. Its unchanged
comparator returned exit 0 with both the complete problem set and error object
equal, after replacing only the exact owned physical prefix. This is error
equivalence, not proof that the graph is valid or that the installer cause is
known. No peer override, optional omission or package pruning was used.

Pre-measurement cache-path and concurrent Git-index preflight errors were
preserved as inconclusive setup attempts; they ran no package workload. A
transient process-inventory result was also preserved before the first install;
a fresh check from the private metadata working folder found no active user.
These setup receipts are not semantic reds or repeated installations.

Current main `22ed1ffaf7a1877d7b3167a71053ecd3c9e702b2` adds only the
separate locked-install-evidence task and plan to this stage's base. Both task
blocks are preserved. Full uncached verification and post-merge GitHub
fixed-status confirmation remain separate delivery requirements. The original
remediation and peer compatibility tasks stay open; keep this stage's task open
until its delivery criteria pass. No claim of all alerts fixed, full-graph
validity or live application deployment follows.
