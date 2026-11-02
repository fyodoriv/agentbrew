# Dependency alert remediation plan

## Overall goal and vision

Remove the frozen vulnerable dependency ranges from the resolved development
and runtime graph. Keep installation, agent configuration and the existing
security overrides working. Use upstream patches through their supported
parent ranges; do not replace dependency auditing or change the Node floor.

This is registration only. No package update, installation or npm audit result
has been produced for this experiment. Commit this prediction before those
operations. Read-only GitHub alert and registry lookups informed the proposal.

## Decision and alternatives

Update the exact Vitest and coverage pair, then resolve the named transitive
patches and the Azure identity parent through npm 10. Reuse npm audit, npm's
resolved-tree output, the existing lockfile check and GitHub's alert status.
The fixed lock query below uses the already declared `semver` dependency; it
is an exact data query, not a new measurement engine or runtime command.

Updating only the top-level MSAL copy leaves the identity parent's nested
vulnerable copy. A global MSAL major override bypasses that parent's contract.
A broad Promptfoo update changes unrelated dependencies. Removing optional
dependencies would hide affected paths rather than repair them. Reject these
alternatives. Keep the jks stub and every unrelated override unchanged.

## Evidence and current state

| Claim | Current source of truth | Delivery path | Status |
| --- | --- | --- | --- |
| The frozen alert definitions are open | GitHub Dependabot IDs in the table below | `package-lock.json` | fact |
| Runtime Ajv accepts the fixed fast-uri patch | locked Ajv 8.20.0, dependency `^3.0.1` | runtime validation | fact |
| Both Undici patch lines fit their current parents | locked Promptfoo 0.124.1 and provider-utils 4.0.57 | development graph | fact |
| Identity 4.13.3 requires MSAL `^6.0.0`; root MSAL alone cannot repair it | current lock | optional Azure graph | fact |
| Published identity 4.14.1 requires MSAL `^7.1.0` | [published parent manifest](https://registry.npmjs.org/@azure%2Fidentity/4.14.1) | accepted by existing parent ranges | fact |
| Vitest and coverage 4.1.12 require the matching pair | [Vitest manifest](https://registry.npmjs.org/vitest/4.1.12), [coverage manifest](https://registry.npmjs.org/@vitest%2Fcoverage-v8/4.1.12) | direct development dependencies | fact |
| The minimal candidate installs and passes the full gate | future exact-tree receipts | scratch install and local gate | verify |

Source baseline: main `b8ce653dc5b83b14ff221f1755538196227c3ba7`, tree
`ffe181177bd692c5a1984b67dcbb3941a90558cc`.
The reviewed `package.json` SHA-256 is
`4351eb54ceffa7599b4d1e2bf77501f60c8e40a14b67901e866cdcdc75c58822`;
the lock SHA-256 is
`c542c3efb4891903a11fe9e4d398eebfc37e269fbff5fd9b7cce05ffc99053af`.

## Scope and minimal targets

| Owner | Existing version/range | Candidate target |
| --- | --- | --- |
| direct `vitest`, `@vitest/coverage-v8` | exact 4.1.11 | exact 4.1.12 together |
| Ajv dependency `fast-uri` | 3.1.8 under `^3.0.1` | 3.1.9 |
| Promptfoo dependency `undici` | 7.30.0 under `>=7.29.1 <8` | 7.30.1 |
| provider-utils dependency `undici` | 6.29.0 under `^6.28.0` | 6.29.1 |
| optional `@azure/identity` | 4.13.3, accepted by Promptfoo `^4.13.3` and ai-projects `^4.13.0` | 4.14.1 |
| every `@azure/msal-node` copy | root 7.0.1 and identity-nested 6.0.1 | 7.1.0; deduplication is allowed |

Only the Vitest pair changes root version declarations. Do not add a root
Azure/Undici/URI dependency, change Promptfoo/Ajv/AI SDK root declarations,
raise `engines.node`, or change `.node-version`. Identity already requires
Node >=22 before this update. Promptfoo already requires Node >=22.22.0.
The root runtime engine declaration does not establish Node 20 support for
that development stack. Use a supported Node version for the experiment.

Keep these current overrides exactly: `simple-git: 4.0.2`,
`basic-ftp: 6.2.3`, and `jks-js: $jks-js`. Preserve the local
`file:scripts/stubs/jks-js` declaration and its files. Do not introduce
`node-forge`, omit optional dependencies, dismiss alerts or disable auditing.

## Frozen advisory/range cohort

Count a row once when any resolved locked copy satisfies its affected range.
Do not count vulnerable package nodes instead of rows: the MSAL row covers
more than one installed copy, and the Undici rows share one advisory ID.
Do not equate npm audit's aggregate count with this frozen metric.

| Alert | Package | Frozen affected range | First fixed version | Primary advisory |
| --- | --- | --- | --- | --- |
| 162 | `@azure/msal-node` | `>=5.0.0-beta.0 <7.1.0` | 7.1.0 | [MSAL origin validation](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5) |
| 161 | `undici` | `>=7.18.0 <7.30.1` | 7.30.1 | [Undici content encoding](https://github.com/advisories/GHSA-xjj6-f33q-929c) |
| 160 | `undici` | `>=6.23.0 <6.29.1` | 6.29.1 | [Undici content encoding](https://github.com/advisories/GHSA-xjj6-f33q-929c) |
| 156 | `fast-uri` | `>=3.0.0 <3.1.9` | 3.1.9 | [Encoded scheme](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) |
| 155 | `fast-uri` | `>=3.0.0 <3.1.9` | 3.1.9 | [Relative path](https://github.com/advisories/GHSA-xhq7-xmqj-769h) |
| 154 | `fast-uri` | `>=3.1.3 <3.1.9` | 3.1.9 | [Host canonicalization](https://github.com/advisories/GHSA-wjr9-j795-jxcr) |
| 153 | `fast-uri` | `>=3.0.0 <3.1.9` | 3.1.9 | [Suffix scheme](https://github.com/advisories/GHSA-333x-w4r6-6crp) |
| 150 | `@vitest/mocker` | `>=2.1.0-beta.7 <4.1.12` | 4.1.12 | [Manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) |
| 149 | `@vitest/mocker` | `>=4.1.11 <4.1.12` | 4.1.12 | [Redirect allowlist](https://github.com/advisories/GHSA-xp26-3454-mjgp) |

The cohort does not grant permission to ignore a new advisory. Report new
findings separately; do not silently change this denominator after results.

## Boundary and measurement contracts

One experiment invocation owns its private output directory. Keep registry
and tree outputs local. Do not record credentials, owner configuration or
organization payloads. All GitHub commands unset `GH_TOKEN` and `GITHUB_TOKEN`
and use the working GitHub CLI credential. No token is passed in an argument.

Preserve the complete optional graph. A missing expected target or parent,
unresolved npm tree, missing registry data, malformed audit response, registry
failure, unavailable credential or failed lock parse is inconclusive, never
zero vulnerable rows. A lock query cannot establish installation or alert closure.

**Hypothesis:** supported upstream resolution reduces unsafe frozen rows from
the predicted nine to zero, with zero dependency/gate regressions and unchanged
protected overrides, optional declarations and Node floor.
**Success:** zero unsafe rows, every required validation passes, and all frozen
GitHub alerts are `fixed` after default-branch ingestion. A dismissed alert is
not fixed. **Pivot:** any remaining affected copy, missing optional evidence,
unrelated root change, new forge dependency or gate regression rejects this
candidate. Change the parent resolution approach, not the metric or safeguards.
**Anchor:** Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò
et al. (2017), preregistration; primary upstream advisories above.

### A. Baseline and candidate: exact lock query

Run this unchanged after the prediction commit, before package changes, then
against the candidate. Expected baseline: `unsafe: 9`, exit 1. Required
candidate: `unsafe: 0`, exit 0. Exit 2 means invalid evidence. Print only fixed
IDs and counts. The existing npm tree checks below must also pass.

```sh
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const { default: semver } = await import('semver');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.engines?.node !== '>=20.11.0' || pkg.devDependencies?.['jks-js'] !== 'file:scripts/stubs/jks-js') throw new Error();
  const overrides = pkg.overrides;
  if (!overrides || Object.keys(overrides).length !== 3 || overrides['simple-git'] !== '4.0.2' || overrides['basic-ftp'] !== '6.2.3' || overrides['jks-js'] !== '$jks-js') throw new Error();
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error();
  if (Object.keys(lock.packages).some((path) => path === 'node_modules/node-forge' || path.endsWith('/node_modules/node-forge'))) throw new Error();
  const rows = [
    [162, '@azure/msal-node', '>=5.0.0-beta.0 <7.1.0'],
    [161, 'undici', '>=7.18.0 <7.30.1'],
    [160, 'undici', '>=6.23.0 <6.29.1'],
    [156, 'fast-uri', '>=3.0.0 <3.1.9'],
    [155, 'fast-uri', '>=3.0.0 <3.1.9'],
    [154, 'fast-uri', '>=3.1.3 <3.1.9'],
    [153, 'fast-uri', '>=3.0.0 <3.1.9'],
    [150, '@vitest/mocker', '>=2.1.0-beta.7 <4.1.12'],
    [149, '@vitest/mocker', '>=4.1.11 <4.1.12'],
  ];
  for (const name of ['promptfoo', 'ajv', '@ai-sdk/provider-utils', '@azure/identity', 'vitest']) {
    if (!lock.packages['node_modules/' + name]) throw new Error();
  }
  const optional = lock.packages['node_modules/promptfoo'].optionalDependencies;
  if (optional?.['@azure/identity'] !== '^4.13.3' || optional?.['@azure/msal-node'] !== '^7.0.0') throw new Error();
  const unsafe = rows.filter(([, name, range]) => {
    const copies = Object.entries(lock.packages).filter(([path]) =>
      path === 'node_modules/' + name || path.endsWith('/node_modules/' + name));
    if (!copies.length || copies.some(([, pkg]) => !semver.valid(pkg.version))) throw new Error();
    return copies.some(([, pkg]) => semver.satisfies(pkg.version, range, { includePrerelease: true }));
  }).map(([id]) => id);
  console.log(JSON.stringify({ cohort: rows.length, unsafe: unsafe.length, ids: unsafe }));
  process.exitCode = unsafe.length ? 1 : 0;
} catch {
  console.error('dependency-controls: evidence unavailable');
  process.exitCode = 2;
}
NODE
```

This query deliberately does not export a helper or create an app action.
An unavailable `semver` import is a setup failure, not a semantic red.

### B. Existing registry, tree and lock validation

Set `DEPENDENCY_EVIDENCE_DIR` to an invocation-owned private directory before
running these commands. Retain exit codes separately; do not use `|| true` to
turn audit or service failure green. Registry advice can differ over time, so
keep its response timestamp alongside the exact source tree.

```sh
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm audit --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/audit.json"
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --package-lock-only --all --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/locked-tree.json"
heavy-run bash scripts/check-lockfile-sync.sh
```

Audit exit 1 is expected for a valid vulnerable baseline. Inspect the JSON
error field and vulnerability data before interpreting it. Candidate audit
must contain no frozen advisory finding and no new unresolved security
finding. Unknown service responses remain inconclusive even if the lock query
reports zero. The npm tree must resolve the optional Azure graph, not omit it.

### C. Minimal package-manager actions, only after valid baseline

These are future mutation commands, not registration checks. Use npm 10 as the
existing lockfile contract requires. No package action is authorized by a
docs gate alone; the source owner must first accept baseline evidence.

```sh
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm install --package-lock-only --ignore-scripts --include=optional --save-dev --save-exact vitest@4.1.12 @vitest/coverage-v8@4.1.12
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm update --package-lock-only --ignore-scripts --include=optional @azure/identity @azure/msal-node undici fast-uri
git diff -- package.json package-lock.json
```

Review the resulting lock rather than assuming a named update touched only
those nodes. Admit only the target versions above and their required dependency
closure. No unrelated root declarations or overrides may change. If npm cannot
produce that supported graph, stop and revise the approach; do not hand-edit
integrity fields, force a major override or run a broad audit fix.

### D. Installation, full gate and default-branch confirmation

After source/lock review, install the candidate with the normal repository
dependency helper. It must use task-owned `node_modules`, not another
worktree's symlink. Repeat the tree/audit/lock query after installation.

```sh
npm_config_include=optional heavy-run bash scripts/worktree-deps.sh
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --all --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/installed-tree.json"
heavy-run npm run verify
git diff --exit-code b8ce653dc5b83b14ff221f1755538196227c3ba7 -- .node-version scripts/stubs/jks-js
git diff --check
```

Only after normal source delivery and default-branch ingestion, run:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh api --paginate --slurp 'repos/fyodoriv/agentbrew/dependabot/alerts?per_page=100' > "${DEPENDENCY_EVIDENCE_DIR:?}/alerts.json"
jq -e '[.[][] | select(.number as $n | [162,161,160,156,155,154,153,150,149] | index($n))] | sort_by(.number) | map(.number) == [149,150,153,154,155,156,160,161,162] and all(.[]; .state == "fixed" and .fixed_at != null)' "${DEPENDENCY_EVIDENCE_DIR:?}/alerts.json"
```

Missing alerts, delayed ingestion, dismissal, unknown state or API failure do
not satisfy closure. Keep the task open until this check passes. Do not keep
polling or alter source merely to retrigger Dependabot; report ingestion as
pending separately from the passing local graph result.

## Numbered work breakdown

### 1. Register and preserve the unchanged-source result

- **Why:** prevent a post-hoc choice of advisory count or omitted graph.
- **Parallelism:** registration now; baseline follows its committed gate.
- **Owner / boundary:** source owner, frozen lock and existing advisory services.
- **Change:** this plan and task only. Preserve exact manifest/lock hashes.
- **Evidence / acceptance:** baseline query returns the predicted nine unsafe
  rows; audit/tree responses are valid and include optional targets.
- **Verification:** A and B, with exits and timestamps captured privately.

### 2. Resolve supported upstream fixes

- **Why:** remove vulnerable copies without violating a parent's major range.
- **Parallelism:** depends on accepted 1; independent of queue/Rust runtime work.
- **Owner / boundary:** package manager and source-owned manifest/lock review.
- **Change:** C only, then update the README dependency/security guidance with
  the actual result. Preserve the stub, overrides, optional graph and Node floor.
- **Evidence / acceptance:** zero unsafe cohort rows, supported resolution,
  no unrelated root changes and no new security regression.
- **Verification:** A and B again, exact diff, D installation and full gate.

### 3. Deliver and confirm alert closure

- **Why:** a local safe lock is not proof GitHub has fixed the repository alerts.
- **Parallelism:** depends on 2, outside review and normal merge authorization.
- **Owner / boundary:** root-owned delivery and GitHub default-branch ingestion.
- **Change:** normal PR; no alert dismissals or registry publication.
- **Evidence / acceptance:** exact source gate and leak checks pass; every
  frozen alert later reports fixed with a fixed timestamp.
- **Verification:** D post-merge check. Keep delayed status pending honestly.

## Rollout, security, and regression coverage

The docs-only registration uses `heavy-run npm run verify:changed` and must
report `merge-ready`; otherwise run `heavy-run npm run verify` before its
commit. Agent artifact test exemption: this registers a dependency experiment
without changing deployed instructions or runtime; existing docs/task gates
validate registration. The source/lock change requires the full gate regardless.

Root owns source/lock commits and public delivery. Preserve the published
scheduled-repair branch and the separate queue/Rust worktrees. Never install,
sync, alter Node settings, contact an authenticated cloud provider or exercise
an exploit against a real service to validate this dependency update.

Rollback is a normal owned source revert with its gate, not removal of the
audit, optional graph, override or stub safeguards. Any broader dependency or
Node support work needs a new task and prediction.

## Stage R: separately registered runtime-only amendment

Commit this amendment before runtime-scoped tree/audit commands. Package
changes still require the source owner to accept the scoped baseline. This
partial stage does not complete the original task or waive its full-graph
requirement. Original registration and baseline receipts remain unchanged.

### Exact constraint and source limit

- Published Nunjucks latest is 3.2.4, with optional peer Chokidar `^3.3.0`.
- Both current Promptfoo 0.124.1 and latest 0.125.1 declare Chokidar `5.0.0`
  and Nunjucks `^3.2.4`. The app root also declares Chokidar `5.0.0`.
- npm 10 optional-peer semantics allow absence, not an installed incompatible
  peer. Arborist marks that present edge `INVALID`.
- npm's peer placement rejects a peer inside its dependent. Placing Chokidar 3
  under Nunjucks is not a supported peer fix. Placing 3 at the root or Promptfoo
  level contradicts the required version 5 at that level.
- No supported published latest-version resolution was found under the
  protected root declarations. This is a bounded current metadata conclusion,
  not proof that no future release or separately reviewed upstream change can
  fix the contract.

Primary sources checked:

- https://registry.npmjs.org/nunjucks/latest
- https://registry.npmjs.org/nunjucks/3.2.4
- https://registry.npmjs.org/promptfoo/0.124.1
- https://registry.npmjs.org/promptfoo/latest
- https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#peerdependenciesmeta
- https://raw.githubusercontent.com/npm/cli/v10.9.9/workspaces/arborist/lib/edge.js
  (`error`, lines 217-230: absent optional versus present invalid/peer-local)
- https://raw.githubusercontent.com/npm/cli/v10.9.9/workspaces/arborist/lib/can-place-dep.js
  (lines 134-136: no peer placement inside the dependent)

### Separate stage, not completion

Keep `dependency-alert-remediation` open and preserve its final nine-to-zero
metric and strict full-graph requirement. Introduce a separately registered
runtime stage for fast-uri only. Its result may support partial delivery of
runtime risk reduction; it cannot complete the original task or make the
development tree green.

**Hypothesis:** a supported fast-uri patch reduces the same frozen cohort
from nine unsafe rows to five. The runtime subset 156/155/154/153 moves from
four unsafe rows to zero. Remaining development rows 162/161/160/150/149 stay
explicitly unresolved. No other dependency, override, optional declaration or
Node floor changes.

**Measurement:** preserve the original exact lock-semver query unchanged.
Capture its nonzero exit and output; do not convert it to a passing full-cohort
query. Add the runtime-scoped npm validation commands below only after this
amendment is committed. Record supported Node and npm 10 versions and exact
manifest/lock hashes before and after.

**Success for this stage only:** full cohort reports unsafe five with exactly
149/150/160/161/162 remaining; runtime advisory rows are zero; runtime tree,
runtime audit, lock validation and required repository gate pass. All protected
data remains unchanged. GitHub later confirms fixed status for the four runtime
IDs. The original full-graph command and final nine-alert acceptance remain
non-green/open until actually resolved.

**Pivot:** any remaining runtime row, hidden optional graph, missing registry
evidence, unsupported resolution, extra package movement or regression rejects
the runtime stage. Do not force peers, downgrade root Chokidar, remove the dev
graph, change full-tree exit codes or reduce the final task denominator.

**Anchor:** original primary fast-uri advisories; Basili, Caldiera and Rombach
(1994), Goal Question Metric; original committed dependency plan.

### Exact runtime stage commands

Use an invocation-owned `DEPENDENCY_EVIDENCE_DIR`, one canonical heavy-run
reservation and the existing worker limit. These commands inspect a runtime
view; `--omit=dev` here does not delete development records from the lock or
grant permission to omit optional dependencies.

Before package changes, run the unchanged original nine-row lock query and:

```sh
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --package-lock-only --all --omit=dev --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/runtime-tree-before.json"
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm audit --omit=dev --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/runtime-audit-before.json"
```

Expected baseline remains four affected runtime rows and nine total unsafe
rows. Runtime-tree validity is an unobserved acceptance prerequisite, not a
passing result at proposal time. Registry, parse or unresolved runtime-tree
failure is inconclusive. If another unrelated runtime finding exists, stop
and review it without changing the frozen cohort.

Only after the source owner reads the scoped baseline, the proposed mutation
is the existing npm updater targeting fast-uri alone:

```sh
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm update --package-lock-only --ignore-scripts --include=optional fast-uri
git diff -- package.json package-lock.json
```

The admitted candidate is fast-uri 3.1.9. Require byte-identical package.json,
Node pin and stub files. Every other lock package record and root declaration
must remain identical to the frozen pre-stage lock. Only the fast-uri record's
published version, integrity, resolved URL and any directly required upstream
metadata can change. If the updater needs unrelated peer movement or returns
an unresolved tree, stop; do not hand-edit the lock or force resolution.

Repeat the unchanged lock query and capture its expected exit 1, then assert
the scoped expected remaining set against its saved JSON:

```sh
jq -e '.cohort == 9 and .unsafe == 5 and ((.ids | sort) == [149,150,160,161,162])' "${DEPENDENCY_EVIDENCE_DIR:?}/lock-query-after.json"
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm ls --package-lock-only --all --omit=dev --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/runtime-tree-after.json"
heavy-run npx --yes --prefer-offline --package=npm@10 -- npm audit --omit=dev --include=optional --json > "${DEPENDENCY_EVIDENCE_DIR:?}/runtime-audit-after.json"
heavy-run bash scripts/check-lockfile-sync.sh
heavy-run npm run verify
```

Runtime tree must exit zero with its complete resolved runtime optional graph;
runtime audit must be a valid response with no remaining security finding.
Absence of an omitted dev path is not evidence that the dev alert is fixed.
Keep normal installation validation separate; do not delete or replace an
existing development node_modules just to obtain an empty runtime report.

Repeat the original full-tree command and keep its raw exit/error evidence.
It remains non-green if the same Nunjucks peer conflict persists. No allowlist
or modified npm flag turns that result into full-graph acceptance. Report the
runtime stage and unresolved full-graph status separately in any PR/report.

After partial delivery, use the original env-unset GitHub API capture for all
frozen IDs. Assert fixed status only for runtime IDs 153/154/155/156; retain
the other IDs and their actual states. Keep the original all-nine fixed-status
check and task open. Do not dismiss or hide the remaining alerts.

No runtime-scoped command or package action ran before this amendment.

After the original env-unset API capture, the exact partial fixed-status
check is:

```sh
jq -e '[.[][] | select(.number as $n | [153,154,155,156] | index($n))] | sort_by(.number) | map(.number) == [153,154,155,156] and all(.[]; .state == "fixed" and .fixed_at != null)' "${DEPENDENCY_EVIDENCE_DIR:?}/alerts.json"
```

Track the unresolved peer contract as `dependency-peer-compatibility`. The
latest checked published metadata does not supply a supported placement under
the protected root declarations. Do not downgrade root Chokidar, force a peer
override, delete optional graph evidence or treat that blocker as solved by
runtime-only validation.
