# Sync selection: synthetic binding preparation

The four target observations remain sealed and have not been run. The existing
handoff requires a separately landed measurement boundary before admitting
them. This first slice checks only whether the real module builder binds eight
named sync functions to explicit fake functions. It cannot measure the CLI,
`update`, startup effects, file writes, or selection behavior.

Goal: prepare an isolated test-only binding check. Question: do all eight
builder entries call their matching fake exactly once without invoking the
instrumented process or network APIs?
Predict 8/8 matching calls, zero mismatches and zero attempts through the
instrumented child-process and network APIs. The test uses synthetic inputs only. No target selection string is
admitted, and no baseline receipt is created.

Before test code, commit this plan. Add a dedicated
`vitest.sync-binding-prep.config.ts` by copying the existing `vitest.config.ts` object and its `test` object, then
replacing `test.include` with the one file `src/sync-selection-binding.prep.ts`
and setting `test.cacheDir` beneath the scratch `TMPDIR`.
Do not use `mergeConfig`: its array merge concatenates the default glob. It retains the ordinary scratch HOME,
task-write guard, telemetry environment and timeouts. Because that filename
does not end in `.test.ts`, default discovery must not list it.

Before dynamically importing the real `buildSyncModules`, install and canary
all process and network sentinels and mock `./update.js` (a static dependency
of the builder), plus its eight imported sync modules. Each fake appends its own fixed name to a private in-memory
array and resolves without output. Mock Node child-process exports used by the
import graph to throw a fixed refusal. Deny network at the OS boundary in
addition to the fetch and socket sentinels. Do not call `buildProgram`,
`update`, the CLI, or a real sync function. Call the eight built entry
functions once each, with no shared state argument, in the builder's order.
Check exact names, order, distinct function identities, exact fake call count,
and zero attempts through the instrumented network and child-process APIs.
Restore sentinels after each test.
A ninth test rejects a deliberately mislabeled fake-call receipt; its input is
an independent fixed synthetic array, not one of the four target cases.

Red: first add only a placeholder test named `binding preparation is installed`
which fails with the fixed text `binding preparation unimplemented`; require
its named failure, nonzero status and that diagnostic. Then replace it with the
nine checks. Measure only with the exact sandboxed sequence below.

Require nine passed tests, no skip or todo, exact eight-call receipt and zero attempts through the instrumented APIs. Before any test run, the dedicated static listing must return exactly the one
preparation path and no other test path. The default-discovery output must
contain zero paths ending
in `sync-selection-binding.prep.ts`. The placeholder red follows both static listings and uses the first command
with `-t 'binding preparation is installed'`; its setup must complete and the
named assertion must fail, not an import or configuration error. The second
command's successful exit and absence check are required, not an empty or failed
listing. Preserve the explicit full command and results in the PR. Run the
ordinary uncached repository gate and independent review before merging.
Before the full gate, confirm the closed controlled source-lease describe is
absent, the four target cases were not added, and the ordinary include still
excludes the preparation file.

Pivot: any incorrect binding, missed sentinel, unexpected I/O, default
discovery, setup failure counted as red, or unbounded output rejects this slice.
Do not use a pass here as evidence that the future CLI/update baseline is safe.
The four target cases still require a separately registered CLI/update boundary,
receipt schema, all side-effect mocks and controlled actual-exit proof before
one-time capture. Real output and the production fix remain further steps.

Anchors: current `src/sync-runner.ts` binding list; Basili, Caldiera and
Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration.

The exact nine case names are `mcp binding`, `rules binding`,
`commands binding`, `agents binding`, `skills binding`, `hooks binding`,
`models binding`, `instructions binding`, and `mismatch and sentinels refuse`.
Each of the first eight separately builds the eight-entry list, checks the
entire ordered name list and distinct callbacks, passes a fixed synthetic options object to the builder, invokes only its matching
entry with no shared context, and requires exactly its own fake call with the
same options object and `undefined` context. The ninth passes an independently mislabeled receipt to
the checker and verifies each installed child-process, fetch and socket
sentinel refuses its synthetic canary without making a real call. Counter
checks distinguish canaries from the eight binding controls. Install exactly
15 throwing sentinels: `child_process.exec`, `execFile`, `spawn`, `fork`,
`execSync`, `execFileSync`, and `spawnSync`; global `fetch`; `net.connect`,
`net.createConnection`, and `net.Socket.prototype.connect`; and `http.request`,
`http.get`, `https.request`, and `https.get`. Install them before the dynamic
import and synchronize built-in ESM exports. Require all 15 individually named
canary counters to equal one before resetting them, then require all 15 to stay
zero during each builder binding. A missing sentinel or alias is failure. All sentinels
are installed before the dynamic import and restored after the suite.

Run the following command once with `red`, after adding the placeholder, and
once with `green`, after replacing it. Both runs repeat the static listings
before the test. Logs and JSON stay in a new private temporary directory.
A network- and write-restricted sandbox applies to every Vitest invocation.
The trusted Mac-wide scheduler runs outside the sandbox; the test launcher and
Node process use a clean environment and pinned local Node binary. The test
launcher never invokes npm or attempts dependency installation. Test names are
top-level `it` names with no enclosing `describe`, so their full names are
exactly those listed above.

```sh
bash -s -- red <<'BASH'
set -eu
mode=$1
case "$mode" in red|green) ;; *) exit 2 ;; esac
umask 077
logs=$(mktemp -d "${TMPDIR:-/tmp}/sync-binding-prep.XXXXXX")
logs=$(cd "$logs" && pwd -P)
mkdir "$logs/home" "$logs/tmp"
printf 'Private logs: %s\n' "$logs"
nodebin="$HOME/.local/share/fnm/node-versions/v24.21.0/installation/bin/node"
[ -f "$nodebin" ] && [ ! -L "$nodebin" ]
[ "$(stat -f '%u %Lp %z' "$nodebin")" = '501 755 122129232' ]
[ "$(shasum -a 256 "$nodebin" | cut -d ' ' -f 1)" = e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b ]
[ "$(git rev-parse HEAD)" = 806ad42b6e769ed4494c4623cb44b9341e6bbebd ]
git diff --quiet && git diff --cached --quiet
git status --porcelain --untracked-files=all >"$logs/worktree.status"
[ "$(wc -l < "$logs/worktree.status" | tr -d ' ')" -eq 2 ]
grep -Fxq '?? vitest.sync-binding-prep.config.ts' "$logs/worktree.status"
grep -Fxq '?? src/sync-selection-binding.prep.ts' "$logs/worktree.status"
printf '%s  %s\n' \
  562289924441cbdb80788049d13673da5419141f76f178b67a7da2993a5bd7b8 package-lock.json \
  298abdea594db3976570bc8dd4138442ba1e248cc4035640a6efda99aa117e4c src/core/agents.yaml \
  39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6 node_modules/vitest/vitest.mjs \
  260a0a7a96a35e1b657480014c0f3b592b70061e42099edefc8fe97972f05fd4 node_modules/vite/package.json | shasum -a 256 -c
repo=$(pwd -P)
realhome=$(cd "$HOME" && pwd -P)
node_dir=$(dirname "$nodebin")
case "$repo$realhome$node_dir$logs" in *\"*|*\\*) exit 2 ;; esac
printf '(version 1) (allow default) (deny network*) (deny file-read* (subpath "%s")) (allow file-read* (subpath "%s") (subpath "%s")) (deny file-write*) (allow file-write* (subpath "%s") (literal "/dev/null"))\n' "$realhome" "$repo" "$node_dir" "$logs" >"$logs/sandbox.sb"
mkdir -p "$realhome/.local/state/agentbrew/experiments"
canary=$(mktemp -d "$realhome/.local/state/agentbrew/experiments/sync-binding-read-canary.XXXXXX")
trap 'rm -rf "$canary"' EXIT
printf '%s\n' 'synthetic private-read canary' >"$canary/record"
grep -Fxq 'synthetic private-read canary' "$canary/record"
ln -s "$canary/record" "$logs/private-alias"
if /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/cat "$logs/private-alias" >"$logs/alias-canary.out" 2>"$logs/alias-canary.err"; then exit 1; fi
! grep -Fq 'synthetic private-read canary' "$logs/alias-canary.out"
if /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/cat "$canary/record" >"$logs/private-canary.out" 2>"$logs/private-canary.err"; then exit 1; fi
! grep -Fq 'synthetic private-read canary' "$logs/private-canary.out"
/usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/cat "$repo/src/core/agents.yaml" >"$logs/repo-canary.out" 2>"$logs/repo-canary.err"
[ -s "$logs/repo-canary.out" ]
run_vitest() { JOBS=1 heavy-run /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /usr/bin/env -i HOME="$logs/home" TMPDIR="$logs/tmp" PATH="$(dirname "$nodebin"):/usr/bin:/bin" CI=1 "$nodebin" "$PWD/node_modules/vitest/vitest.mjs" "$@"; }
run_vitest list --config vitest.sync-binding-prep.config.ts --filesOnly --staticParse >"$logs/dedicated.list" 2>"$logs/dedicated.err"
[ "$(wc -l < "$logs/dedicated.list" | tr -d ' ')" -eq 1 ]
grep -Eq '(^|/)src/sync-selection-binding\.prep\.ts$' "$logs/dedicated.list"
run_vitest list --filesOnly --staticParse >"$logs/default.list" 2>"$logs/default.err"
[ -s "$logs/default.list" ]
! grep -Eq '(^|/)src/sync-selection-binding\.prep\.ts$' "$logs/default.list"
status=0
if [ "$mode" = red ]; then
  run_vitest run --config vitest.sync-binding-prep.config.ts --maxWorkers=1 --reporter=json --outputFile="$logs/result.json" -t 'binding preparation is installed' >"$logs/run.out" 2>"$logs/run.err" || status=$?
else
  run_vitest run --config vitest.sync-binding-prep.config.ts --maxWorkers=1 --reporter=json --outputFile="$logs/result.json" >"$logs/run.out" 2>"$logs/run.err" || status=$?
fi
printf '%s\n' "$status" >"$logs/status"
env -i HOME="$logs/home" PATH=/usr/bin:/bin "$nodebin" - "$mode" "$logs/result.json" "$status" <<'NODE'
const fs = require('node:fs');
const [mode, path, status] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(path, 'utf8'));
const cases = report.testResults.flatMap(file => file.assertionResults);
const names = ['mcp binding', 'rules binding', 'commands binding', 'agents binding', 'skills binding', 'hooks binding', 'models binding', 'instructions binding', 'mismatch and sentinels refuse'];
const ok = mode === 'red'
  ? Number(status) !== 0 && cases.length === 1 && cases[0].fullName === 'binding preparation is installed' && cases[0].status === 'failed' && cases[0].failureMessages.some(message => message.includes('binding preparation unimplemented'))
  : Number(status) === 0 && report.success === true && cases.length === 9 && cases.every(c => c.status === 'passed') && new Set(cases.map(c => c.fullName)).size === 9 && names.every(name => cases.some(c => c.fullName === name));
if (!ok) process.exit(1);
console.log(`sync binding ${mode}: verified`);
NODE
BASH
```

For green replace only the `red` argument on the opening `bash` line with
`green`. Any missing JSON field, setup error, unknown status, mismatch, extra
assertion, unproved sentinel or missing log rejects the slice. An exact-head
independent review follows the green and the ordinary full gate.

Independent static review traced 124 local runtime-reachable TypeScript files,
excluding the mocked update and eight sync modules. It found one definite
import-time read: `types.ts` loads repository-owned `src/core/agents.yaml`.
That read is allowed and pinned above; no zero-read claim is made. Several
modules construct HOME-derived paths without reading them. The review found
no direct top-level writes, child launches or network operations in that local
graph. It does not prove third-party initializers or indirect calls safe;
the OS write and network restrictions, clean environment, and pre-import
sentinels remain required. The base commit pins tracked sources; lockfile and
entrypoint hashes do not prove all installed dependencies immutable.

Independent review found no remaining concrete blocker to registering this
plan. The sandbox and canaries have not yet run. No baseline or target case
is authorized by this preparation.

Process-attempt counts cover the named instrumented Node APIs and reviewed
local initializers only. The profile does not prove that unaudited native or
third-party code cannot launch a child. The OS profile does deny network and
owner-home reads outside the explicit repo and Node directories. The two
canaries exercise direct and scratch-symlink paths; they do not prove all
possible aliases or dependency immutability.
