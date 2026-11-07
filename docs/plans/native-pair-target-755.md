# Existing native pair target control: issue 752

The two earlier synthetic asset-set models were rejected. This is a distinct
test of the existing #764 pair verifier, not another proposed asset-set model.
The local #755 composition remains uncommitted and conflicted. Its draft parent
is `9db12ffc85591dddc75f38e7170c6ab0f7a60f25`, its merge parent is
`24a3c6fbbd83b685fe142699eaf0d935f0e70406`, and the composed publisher source
hash is `88e5367f3e70cf92ff6638c4e395712de5ce269654f0f5fff418b5caefbeb626`.
The actual `scripts/native-build-tools.mjs` verifier has Git blob
`3eed5ea3889e99a8f57f090fd8da842e098c8616` on that parent and on current
Agentbrew main `8c8a18141c489a38539db073014ab7bbe69c049e`. Recheck pins and
source ownership before implementation; do not resolve the merge here.

Goal: establish what the real pair verifier does with its fixed target.
Question: does it reject a self-consistent wrong-target manifest while
accepting an otherwise identical fixed-target manifest? Predict 1/1 valid
default-target fixture accepted and 1/1 wrong-target fixture refused; an
alternate-recipe canary with only its manifest target restored must also pass.
No fixture bytes are executed and no compiler, child process or network call
may occur. The earlier #764 suite already tests a simpler wrong-target mutation;
this control isolates the fixed target from the recipe comparison.

Commit this prediction before creating the test. Use a private scratch home
and tree with exactly the verifier's declared source files, non-executable
synthetic bytes and private modes. Build two synthetic byte buffers that pass
the actual structural arm64 Mach-O checks; they contain no runnable program.
Use the real exported `makeManifest`, `inputs` and `validateManifest`, not a
new substitute verifier. Pin source set, modes, byte lengths and hashes in
the fixture; do not use an ignored target binary or run the pair.
For each declared source path, the scratch fixture bytes are the UTF-8 string
`fixture:` followed by that relative path and one newline, mode `0600`. After
this prediction is committed, materialize the synthetic pair and commit a
fixture receipt with its exact bytes, lengths, modes and SHA-256 hashes before
running the verifier. The tests must assert that receipt and the exact source
set. The verifier's structural checks are not signature or execution proof.

For `expected_target_accepted`, verify the default production recipe and
target accept the complete synthetic pair. For `wrong_target_refused`, create
a self-consistent alternate recipe and hash with target
`x86_64-unknown-linux-gnu` and pass
that same recipe as the verifier argument. First prove that manifest with the
fixed target is accepted. Then change only `manifest.target` to the alternate
target and require refusal. The alternate recipe is a test probe only; the
production default remains unchanged.

Install pre-import sentinels for `child_process.execFileSync`, `spawn`,
`spawnSync` and `execFile`; global fetch; `net.connect`, `createConnection`
and `Socket.prototype.connect`; and HTTP/HTTPS `request` and `get`. A canary
must call each sentinel, prove it is intercepted, then reset all counts and
require zero calls for both verifier controls. Independently inspect the tested call path
for uninstrumented process or network paths. The synthetic pair is data only;
do not execute it. Verify the existing #764 frozen control file
`src/source-build-capability.test.ts` remains Git blob
`edd9a50eac8d9d297fac0d11e2b55abe5654bede` in the composition.

The two exact Vitest names in `src/judges/native-pair-target.test.ts` are
`expected_target_accepted` and `wrong_target_refused`. Run this measurement:

```sh
bash <<'BASH'
set -o pipefail
report=$(mktemp) || exit 2
trap 'rm -f "$report"' EXIT
test -f src/judges/native-pair-target.test.ts || exit 2
JOBS=1 heavy-run npm exec -- vitest run src/judges/native-pair-target.test.ts --maxWorkers=1 --reporter=json --outputFile="$report" || exit 1
node - "$report" <<'NODE'
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tests = r.testResults.flatMap((f) => f.assertionResults);
const names = ['expected_target_accepted', 'wrong_target_refused'];
if (!r.success || r.numTotalTests !== 2 || r.numPassedTests !== 2 || r.numFailedTests !== 0 || r.numPendingTests !== 0 || r.numTodoTests !== 0 || tests.length !== 2) process.exit(1);
for (const name of names) if (tests.filter((t) => t.fullName.endsWith(name) && t.status === 'passed').length !== 1) process.exit(1);
console.log('2 named real-verifier controls passed');
NODE
BASH
```

Success requires both named tests, the alternate-recipe canary, zero real
process or network calls, no executed bytes and independent source review.
Any accepted wrong target, rejected valid fixture, unsafe call or changed
frozen #764 control rejects this approach. Setup failure is inconclusive.
This does not qualify real artifact provenance, the judge reader, compiler
resolver absence, publication, or a no-Cargo install. A later separately
registered plan must bind and qualify those pieces before any production change.

Anchors: #764's source-bound pair verifier and #755's composed publisher;
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration.
