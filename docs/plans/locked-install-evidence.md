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
