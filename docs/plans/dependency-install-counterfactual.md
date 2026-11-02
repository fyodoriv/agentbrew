# Dependency installation counterfactual plan

This diagnostic distinguishes an installation-layout effect from a dependency
patch regression. Register it before the control install. Keep the source
candidate frozen and preserve its failed gate; do not retry or prune modules.

## Overall goal and retained evidence

Distinguish an npm installation/layout effect from a fast-uri patch regression.
The first installed-tree comparison failed and remains failed. Its exact
candidate tree is `12339e9c2aaf3bae922b16403e6eeb15572c2bf6`; the full
repository verify step never ran. The candidate still has five affected dev
advisory rows and a non-green full graph. This diagnostic cannot close those
requirements or replace the original nine-alert experiment.

The lock-only error is unchanged. Actual installed npm output adds these
extraneous packages to the old invalid Chokidar problem:

- `@emnapi/core@1.9.2`
- `@emnapi/runtime@1.9.2`
- `@emnapi/wasi-threads@1.2.1`
- `@napi-rs/wasm-runtime@1.1.4`
- `@tybys/wasm-util@0.10.1`

Read-only metadata shows that all have unchanged optional development records
in both locks. Their WASM binding parents and child dependencies explain a
possible orphan layout, but do not establish the installer cause. None of these
packages has an install script. Do not call this an infrastructure failure.

## Decision, alternatives and evidence

Use a fresh baseline-only installation with the same npm binary and context.
Comparing another lock-only query cannot explain an installed-tree difference.
Pruning packages or filtering the new problems would hide the failure.

| Claim | Source of truth | Status |
| --- | --- | --- |
| The first installed comparison stopped before the full verify command. | Preserved staged-tree receipt and stopped workload stages | fact |
| The added installed problems have unchanged optional lock records. | Original and candidate lock data | fact |
| The unchanged graph has the same installed problems. | The one control below | proposed |

## Registered hypothesis

**Goal/question:** does the same installer on the unchanged dependency graph
produce the candidate's additional installed-tree problems?
**Prediction:** npm 10.9.9 on Node 24.21.0, with the same host, normal scripts
and optional inclusion, produces exactly the same five extraneous package
problems plus invalid Chokidar 5 on the unchanged original lock.
**Measurement:** one fresh private fixture containing only the baseline tracked
package.json, original lock, public registry config and local jks stub, followed by the exact npm ci and
full npm ls commands below. Capture every command's actual exit separately.
**Success for diagnosis only:** npm ci exits zero; the subsequent npm ls exits
one with ELSPROBLEMS; the exact normalized problem set and error code/detail
match the preserved candidate result. Only owned directory prefixes may be
replaced; package names, versions, error classes and additional problems remain.
**Pivot:** a valid control with any different problem set rejects the claimed
installer equivalence and leaves this candidate rejected. Missing assets,
registry data, tool/config identity, failed installation or malformed JSON are
inconclusive. Never prune, filter problems, force peers or repeat until a match.
**Anchor:** Basili, Caldiera and Rombach (1994), GQM;
[npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci/) preserves a lock-bound
install and [npm ls](https://docs.npmjs.com/cli/v10/commands/npm-ls/) reports
extraneous, missing and invalid graph entries. These native commands provide
the measurement; no aggregate audit count substitutes for the frozen cohort.

Matching the control does not turn either full-tree exit into zero. Root must
review the result before deciding whether a separately justified next stage
can resume. No automatic full-gate retry follows the diagnostic.

## Fixture and ownership

Use a clean owned checkout for registration, preserving its previous branch.
The fixture and output directory belong to this diagnostic invocation only;
no app service, shared dependency folder or other checkout is modified.

The experiment directory is new, private and invocation-owned. Its initial
fixture contains only tracked assets from commit
`aad4d7667278a82787f87cce1c130026e06bfc95`:

- package.json, SHA-256
  `4351eb54ceffa7599b4d1e2bf77501f60c8e40a14b67901e866cdcdc75c58822`
- package-lock.json, SHA-256
  `c542c3efb4891903a11fe9e4d398eebfc37e269fbff5fd9b7cce05ffc99053af`
- `.npmrc`, SHA-256
  `3a951f66e7e0f3e2dd1832473a871357c4a507b51100636b73bcf6ff0dd78b6c`,
  whose entire content is `registry=https://registry.npmjs.org/`
- every tracked regular file under `scripts/stubs/jks-js/`, pinned to that commit

Read-only source inspection found no root package lifecycle script. The stub
contains exactly `index.js` (Git blob `a6d09dfb44e6b125ff25b0f41d9e96886ecf15c7`)
and `package.json` (Git blob `38ed2a92e6ec723e40c7522a8e4aa12cf879414d`),
both mode `100644`. The public registry file is an approved fixture asset. Omitting it would
change npm config context.

Do not copy candidate node_modules, agent config, credentials, application
state, source code, a Git directory or a sibling's dependency folder. npm ci
creates a fresh real directory only inside this fixture. Keep the owner HOME,
security shims and normal npm cache/config context. No global config changes.
All logs and the candidate error JSON remain local; do not commit raw paths.

Use the already verified cached npm executable (actual version 10.9.9 and
verified package/executable hashes), not default npm 12. Record Node version,
platform/architecture and the selected tool identity. Config preconditions are
normal scripts (`ignore-scripts=false`), no forced peers (`force=false` and
`legacy-peer-deps=false`) and optional inclusion. Query only those fixed config
keys; never print a complete npm configuration. If the context does not match,
refuse rather than overriding the owner configuration.

## Exact commands to register

The approved durable runner supplies one canonical agentbrew heavy-run project
reservation and JOBS=1. No capacity override or fabricated held marker. The
following variables are reviewed invocation-owned paths, not runtime settings:
SOURCE_ROOT is the registration checkout; OUT is a new private directory;
FIXTURE is its initially absent baseline-fixture child; NPM10 is the verified
cached npm executable. The candidate JSON and its private hash are frozen
before the control. No command below has run at proposal time.

```sh
mkdir -m 700 "${FIXTURE:?}"
git -C "${SOURCE_ROOT:?}" archive aad4d7667278a82787f87cce1c130026e06bfc95 package.json package-lock.json .npmrc scripts/stubs/jks-js | tar -x -C "$FIXTURE"
node --version
"${NPM10:?}" --version
"$NPM10" config get ignore-scripts
"$NPM10" config get legacy-peer-deps
"$NPM10" config get force
```

Verify the exact baseline hashes, stub tracked membership/modes, empty initial
node_modules and absence of any shared-directory link before installation.
Run the fixed config queries from the fixture. Require the three values to be
`false`; no extra project settings are present in the reviewed `.npmrc`.

The helper's npm ci arguments are retained verbatim. Run once from the fixture,
using the same optional environment policy as the candidate:

```sh
npm_config_include=optional heavy-run bash -c 'cd "$1" && "$2" ci --prefer-offline --no-audit --no-fund' _ "$FIXTURE" "$NPM10" > "${OUT:?}/ci.stdout" 2> "$OUT/ci.stderr"
```

Only if ci exits zero, capture the original full installed-tree command:

```sh
heavy-run bash -c 'cd "$1" && "$2" ls --all --include=optional --json' _ "$FIXTURE" "$NPM10" > "$OUT/installed-tree.json" 2> "$OUT/ls.stderr"
```

Exit one is expected for ls, but retain it as non-green output. Compare only
the resulting error evidence, not a claim that the dependency graph is valid.
The fixed data comparison is:

1. Require both JSON objects to contain ELSPROBLEMS and string problem lists.
2. Bind the candidate JSON to the preserved failed result. Keep its hash private.
3. Replace only each reviewed owned root followed by `/` with `<owned-root>/`
   in its own problem strings and error detail. No regex, home-prefix scrub,
   omission, package/version normalization or allowlist.
4. Compare sorted complete problem strings and the complete error object,
   including code, summary and detail. Sort problem strings only; preserve
   summary order and all text except the exact owned prefix replacement.
   Keep raw stdout/stderr and the original order privately for review.
5. Print only a fixed verdict, expected/actual problem counts and equality flags.

This is a direct JSON comparison using existing Node/jq tooling, not a new
measurement engine. Root must approve the frozen comparison before its first
result; do not modify the candidate's failed first comparator.

The exact comparator is below. `CANDIDATE_JSON` is the original stopped gate's
`installed-tree.json`; `CANDIDATE_ROOT` is the physical candidate checkout and
`FIXTURE` is the control root. These path arguments remain private. The fixed
candidate hash is reviewed and bound in a private execution manifest before
the control. `CANDIDATE_SHA256` comes only from that frozen manifest, never a
new hash computed after the control. Do not commit it, raw JSON or owned roots. Exit zero means diagnosis match
only; exit one means a different valid problem set; exit two is inconclusive.

```sh
node --input-type=module - "$CANDIDATE_JSON" "$CANDIDATE_SHA256" "$CANDIDATE_ROOT" "$OUT/installed-tree.json" "$FIXTURE" <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const [candidateFile,expectedHash,candidateRoot,controlFile,controlRoot]=process.argv.slice(2);
try {
  if (!/^[0-9a-f]{64}$/i.test(expectedHash??'')) throw Error('candidate-binding');
  const bytes=fs.readFileSync(candidateFile);
  if (crypto.createHash('sha256').update(bytes).digest('hex')!==expectedHash.toLowerCase())
    throw Error('candidate-input');
  const candidate=JSON.parse(bytes);
  const control=JSON.parse(fs.readFileSync(controlFile,'utf8'));
  function evidence(value,root) {
    if (!path.isAbsolute(root)||path.normalize(root)!==root||root.endsWith('/'))
      throw Error('owned-root');
    if (value.error?.code!=='ELSPROBLEMS'||!Array.isArray(value.problems)||
        value.problems.some(x=>typeof x!=='string')||
        JSON.stringify(Object.keys(value.error).sort())!==
          JSON.stringify(['code','detail','summary'])||
        Object.values(value.error).some(x=>typeof x!=='string'))
      throw Error('error-schema');
    const normalize=x=>x.split(root+'/').join('<owned-root>/');
    return {
      problems:value.problems.map(normalize).sort(),
      error:Object.fromEntries(Object.keys(value.error).sort()
        .map(key=>[key,normalize(value.error[key])]))
    };
  }
  const left=evidence(candidate,candidateRoot),right=evidence(control,controlRoot);
  if (left.problems.length!==6) throw Error('candidate-evidence');
  const problemsEqual=JSON.stringify(left.problems)===JSON.stringify(right.problems);
  const errorEqual=JSON.stringify(left.error)===JSON.stringify(right.error);
  const matched=problemsEqual&&errorEqual;
  console.log(JSON.stringify({verdict:matched?'diagnosis-match':'different-valid-evidence',
    expectedProblemCount:left.problems.length,actualProblemCount:right.problems.length,
    problemsEqual,errorEqual}));
  process.exitCode=matched?0:1;
} catch {
  console.log(JSON.stringify({verdict:'inconclusive-input'}));
  process.exitCode=2;
}
NODE
```

Require the captured install exit to equal zero and the ls exit to equal one
before invoking this comparator. A valid control problem count other than six
is a different problem set and exits one. No result filters those problems.

## Registration, acceptance and remaining work

The docs-only gate is `heavy-run npm run verify:changed -- HEAD`, requiring actual zero
and merge-ready; otherwise use the normal full gate. Commit registration before
creating/installing the fixture. Registry/setup errors never justify a package
change or a manual cleanup. Preserve the fixture and all receipts for review.

The dependency source candidate remains frozen. No source commit, publication,
app/service update or nine-alert completion is authorized by this diagnostic.

## Numbered work and rollout

1. **Register the diagnostic.** Owner: the dependency task. Why: distinguish
   a candidate regression from installer layout without changing the metric.
   Dependency: preserve the first failure and approve private input bindings.
   Change: this plan and the task queue only. Verification: the explicit-HEAD
   docs gate above must return zero and say merge-ready before the commit.
2. **Run the control once.** Owner: one invocation-owned fixture. Dependency:
   registration commit and reviewed exact comparator. Why: test unchanged
   dependencies under the same installer context. Run the frozen commands;
   retain actual exits and complete outputs privately. Accept only the numeric
   diagnosis threshold above, with no retry, prune or package mutation.
3. **Review the result.** Owner: a separate source reviewer. Dependency: actual
   control receipt with unchanged fixture inputs. Why: avoid turning an
   explanation into a false green gate. A match permits a later decision, not
   an automatic full-verify retry, source commit or publication. A valid
   mismatch rejects equivalence; setup failure remains inconclusive.

The original nine-alert task and all five affected development rows remain
open. The partial runtime result does not waive the strict full-graph requirement
or post-merge fixed-status confirmation. This plan authorizes no peer forcing,
root dependency downgrade, app update, source change or global config change.

