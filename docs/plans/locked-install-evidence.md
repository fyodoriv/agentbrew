# Locked installation evidence

Registered preparation: 2026-11-02, from main `d80b9be`.
Task: `locked-install-evidence`. No repair or new experiment result is included.

## Observed boundary

`scripts/build-pipeline-guard.sh` runs `npm ls --depth=0`, then reports a
lockfile match. A task-owned review checkout had fast-uri3.1.8 installed while
its tracked lockfile selected3.1.9; this shallow guard passed. This observation
establishes the gap, not the outcome of the controls registered below.

`scripts/worktree-deps.sh` checks source lockfile equality before cloning a
donor. It does not qualify the donor's installation stamp or package contents.
After cloning, it writes the target's current lock stamp. The target shortcut
also treats a matching stamp as sufficient evidence. Those are source findings;
a stale-donor experiment has not run yet.

`scripts/verify.sh` excludes ignored node_modules from its input identity. Its
shared cache therefore does not establish that a previously successful step ran
against the installation now selected. A stamp records installation history;
it is not automatically proof of package-content equality.

## Reuse and scope

First assess maintained npm dependency tooling and its supported data surfaces.
[npm ls](https://docs.npmjs.com/cli/v11/commands/npm-ls/) documents a logical
dependency tree and depth-limited traversal.
[package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)
describes the resolved installation tree. A depth-zero successful exit is not
an exact comparison between those two trees. `npm ls --all` alone must not be
substituted for a demonstrated lock-exact comparison.

Keep optional dependencies, local-file stubs, platform selections, overrides
and the Node floor unchanged. Preserve the existing unsupported optional-peer
evidence. Neither omission nor a new allowlist is a passing result. New owned
runtime code follows the phased Rust plan; necessary shell entry points may
wrap a qualified maintained tool. Do not build a second dependency resolver.

## Instrumentation first

Before changing production behavior, land a preparation PR that adds frozen,
offline synthetic controls to the existing test files and reports each
boundary's actual decision. A preparation gate can assert the accuracy of its
measurement against sealed sample decisions; it must not call unsafe current
decisions acceptable. Record old-source decisions separately and retain them.

Inspect available resolver output before fixing the projection or oracle.
Commit that exact adapter/output and identity prediction before measuring it.
Fixtures must use synthetic packages and temporary task-owned directories;
never seed vulnerabilities or mutate canonical dependencies for a control.

Freeze these five negative scenarios before their first execution:

| ID | Fixed scenario | Required post-repair decision |
| --- | --- | --- |
| N1 | A transitive installed version differs from the exact lock selection while satisfying its parent's range | No lock-exact readiness receipt |
| N2 | Donor source lock equals target lock, but donor installed transitive content is stale | No trusted clone receipt; supported reinstall or explicit refusal |
| N3 | Target lock stamp matches, but installed package metadata has drifted | No unchanged-install shortcut based on the stamp alone |
| N4 | Installed-tree identity changes after a successful gate, with tracked source unchanged | No reuse of that gate as current-install evidence |
| N5 | The selected comparison fails, omits required evidence or returns malformed output | Unknown/refused; no manufactured success or stamp |

Freeze these four positive scenarios too:

| ID | Fixed scenario | Required decision |
| --- | --- | --- |
| P1 | A complete supported task-owned installation matches its exact lock selection | Qualified readiness |
| P2 | A qualified donor and target share the same supported lock and installation identity | Clone succeeds with an accurate receipt |
| P3 | An optional package is legitimately absent under the declared platform selection | Correct optional projection, not a false missing-required error |
| P4 | The existing local-file stub is correctly installed under the unchanged declaration | Supported local-file identity preserved |

Keep setup failures, expected unsafe baseline decisions and actual repair
results separate. Do not claim all five baseline negatives are currently
permitted before running them. Run the same frozen inputs and oracle before
and after repair; never derive expected decisions from the candidate output.

## Registered metric and decision

GQM goal: make build and installation receipts honest about the selected
dependency tree. Question: can stale or unknown installation evidence be
accepted as lock-exact, or reused after it changes?

Metric: unsafe permits among N1–N5, measured per scenario; correct supported
decisions among P1–P4, reported separately. Predicted post-repair unsafe permits:
0/5. Predicted supported decisions:4/4. Baseline is unmeasured at registration.

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/build-pipeline-guard.test.ts src/worktree-deps.test.ts src/scripts/verify-cache.test.ts
JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

Success requires0/5 unsafe permits and4/4 supported decisions, qualified
task-owned installation evidence, unchanged dependency policy and passing
repository gates. Pivot on any unsafe permit, unsupported omission, false
stamp, unrelated cached success, canonical installation mutation or concealed
peer error. A fixture pass is not proof that every live package is secure.

Anchors: Basili, Caldiera and Rombach (1994), *Goal Question Metric*;
Munafò et al. (2017), *A manifesto for reproducible science*; the primary npm
contracts above. Preserve the original dependency-remediation task's full
acceptance requirements.

## Frozen observation preparation

Register this preparation before implementing its fixtures or running their
baseline. Production guard, clone, stamp and cache behavior stays unchanged.
This preparation measures those boundaries; it does not repair them.

Use only invocation-owned synthetic package trees. Root selects
`fixture-parent@1.0.0`; the parent accepts `fixture-leaf:^1.0.0`; the lock selects
leaf `1.0.1`. The stale physical leaf is `1.0.0`. Freeze complete source locks,
hidden locks, manifests, bytes and expected path identities before execution.
N1 and N3 keep matching hidden locks and stamps while physical files differ.
Do not delete hidden locks or change directory timestamps to expose drift.

| ID | Frozen preparation and observable boundary |
| --- | --- |
| N1 | Run the real guard with pinned npm on the stale physical leaf. Record its exit and exact readiness marker. Independently read the known fixture leaf metadata. |
| N2 | Give the real helper equal source locks and a stale donor tree. Record clone/install selection, resulting physical content, npm calls and target stamp. A stamped stale clone is unsafe. |
| N3 | Give the real helper a matching target stamp and stale physical leaf. Record whether its unchanged-install shortcut accepts the tree. |
| N4 | Run a dependency-sensitive counting step successfully, then change only ignored installed payload bytes so the step would fail if executed. Record second-run cache reuse and the execution count. Keep tracked source unchanged. |
| N5 | Supply failed, missing and malformed npm evidence through the existing finite tool port. Record each variant; any readiness or trusted stamp without complete evidence makes this one scenario family unsafe. |
| P1 | Run the real guard on the complete matching synthetic tree. Preserve the actual npm response. |
| P2 | Clone a qualified matching synthetic donor. Compare physical content and stamp with the independently frozen fixture. |
| P3 | Keep required packages present; omit an optional package under a frozen incompatible platform declaration. Preserve that declaration and actual npm response. |
| P4 | Copy the existing public local-file stub verbatim into scratch storage under its unchanged declaration. Verify link/target identity and source bytes. |

For N4, ignore `node_modules/` in the scratch repository. Otherwise tracked-input
invalidation would conceal the installation-identity boundary. Do not widen the
five-negative denominator when N5 has more than one variant.

The test-local observation record has fixed scenario and boundary labels,
actual exit, readiness marker, clone/shortcut selection, stamp equality,
fixture-content equality, cache reuse and evidence completeness. Missing or
malformed observations are inconclusive. They cannot produce a zero-unsafe
claim. Derive required decisions from the matrix above, never from current
production output. Keep unsafe baseline permits visibly distinct from passing
recorder calibration. Do not assert that every negative currently permits.

GQM preparation question: does the recorder preserve the observed decision and
distinguish an unsafe permit, a supported decision and incomplete evidence?
Predict zero classification errors against sealed sample observations, and
complete observation records for each registered scenario. Pivot on any
misclassification, manufactured completeness, changed fixture, hidden-lock
removal, canonical installation access or suppressed error. Baseline unsafe
permits remain unmeasured until this registration is committed. The repair
target remains zero unsafe permits and all supported decisions correct.

Use the registered focused and full commands above. Keep instrumentation in
the existing test files; do not add a production resolver or comparator yet.
Freeze the sample observations and expected classifications before their first
execution, then retain their hashes and the actual baseline records privately.

Also capture the maintained-tool capability on the same scratch fixtures with
the already qualified npm 10.9.9 executable, without installation or network:

```sh
"$NPM10" query '*' --json
"$NPM10" query '*' --package-lock-only --json
"$NPM10" ls --all --long --include=optional --json
```

Preserve each exit, stdout and stderr separately. Compare reported metadata
with the known physical fixture paths before proposing a production projection.
The [npm ls contract](https://docs.npmjs.com/cli/v10/commands/npm-ls/) describes
a logical tree. The [npm query contract](https://docs.npmjs.com/cli/v10/commands/npm-query/)
offers actual and lock-only queries, but array equality is not yet lock-exact
proof. npm's [hidden-lock contract](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/#hidden-lockfiles)
warns that edits can escape its directory-mtime check. Retain that condition.
The GQM and preregistration anchors above also apply to this preparation.

Synthetic success cannot waive existing optional-peer errors or establish
general package-content integrity. New production runtime logic still follows
the phased Rust plan. A complete observation preparation must land before its
production repair is implemented.

### Test-only tool port and cohort selection

Ordinary tests always run the sealed observation-recorder calibration. The real
measurement cohort runs only when `LOCKED_INSTALL_OBSERVATION=1`. Without that
selection its cases are visibly unrun; ordinary npm versions are not a measured
baseline or a new unsupported-version policy.

The selected cohort uses `LOCKED_INSTALL_OBSERVATION_NPM_CLI`, an absolute path
to the already qualified npm CLI JavaScript file. Its portable default is the
caller's `npm_execpath`. Tests require npm package metadata and actual version
output to identify npm 10.9.9. A missing, unreadable or wrong-version tool emits
an inconclusive observation and fails the selected cohort. Tests never install,
download or search a private npm cache for a substitute.

Use the same registered commands with these test-only environment additions:

```sh
LOCKED_INSTALL_OBSERVATION=1 LOCKED_INSTALL_OBSERVATION_NPM_CLI="$NPM10_CLI" JOBS=1 heavy-run npx vitest run --reporter=default --silent=false --maxWorkers=1 src/build-pipeline-guard.test.ts src/worktree-deps.test.ts src/scripts/verify-cache.test.ts
LOCKED_INSTALL_OBSERVATION=1 LOCKED_INSTALL_OBSERVATION_NPM_CLI="$NPM10_CLI" JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

`NPM10_CLI` is selected locally before admission; its private path is never
committed. Each scenario/variant emits one `LOCKED_INSTALL_OBSERVATION` JSON
line with actual decisions and completeness. Bounded raw synthetic command
responses use a separate `LOCKED_INSTALL_CAPABILITY` JSON line. Retain the
complete log privately. Public evidence uses aggregate fields only.

Use the explicit default reporter for the focused receipt capture. The pinned
Vitest agent reporter selects passing-console suppression; changing only the
silent option does not override its reporter option. The first selected attempt
passed its tests but retained zero observation lines where eleven were required.
Its classification result is inconclusive, not zero unsafe permits. Preserve
that attempt. Correct only the reporter selection and repeat the same sealed
inputs; do not change fixture bytes, classifications or required decisions.
The full gate remains a compatibility check; the focused log supplies the
complete durable measurement receipts.

Recorder completeness and comparison-evidence completeness are distinct. A
complete observation of a malformed or missing npm response can establish an
unsafe readiness claim; missing observations cannot establish zero unsafe
permits. N5 remains one family with its three frozen variants. Calibration
passes only when sealed unsafe, supported, refused and inconclusive samples
retain their registered labels. It does not assert that unsafe baseline
behavior is acceptable or repaired.
