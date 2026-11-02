# MCP invalid package metadata compatibility

Registered amendment: 2026-11-02, before the metadata repair or its new safety
control. This extends PR #607. It changes no namespace, receipt, ownership,
fresh-runtime consent, publication or deadline policy.

## Goal, question and metrics

Goal: retain the build helper's safe return contract while refusing candidate
activation when package metadata is invalid.
Question: can the helper return without throwing or running npm, while a
first install with invalid package metadata and a tracked `index.js` still
refuses before publication?

The qualified adapter baseline at tree
`14af6be9a0ba0c3b89c2d9e337fae04c28b4dc6b` has one semantic failure among
the retained 54 units: the malformed-JSON helper expects no throw and receives
`MCP candidate refused: package metadata is invalid.` The fixture owns a real
private, unsealed attempt and writes actual malformed bytes. The production
parse catch is reached before npm. The other 53 units and two separate real
ownership guards pass. This is not a fixture setup failure.

Hypothesis: a typed helper refusal and an explicit caller refusal reduce the
helper's throw failures from 1/1 to 0/1. A new safety control must preserve
unsafe activation permits at 0/1 before and after the repair. A tracked
entrypoint must not turn invalid metadata into a skipped-build fallback.
No command may run npm for either malformed input.

## Fixed controls and baseline order

Preserve the existing helper assertion and its no-npm oracle. Its adapted file
SHA256 before this amendment is
`a277013834118b0a0d68489bb194b8bab73fd737cc3e6e9eb7a9debd57acc517`.
Preserve all 54 retained unit cases, the two separate ownership guards, the
real-Git 51, the environment counter and the original five-second deadlines.

After this prediction is committed, add one separate first-install boundary
control named `refuses invalid package metadata before publishing a tracked
entrypoint`. Use the existing isolated candidate fixture and offline scratch
Git ports. Commit malformed `package.json` and a tracked `index.js` in the
fixture source. The candidate must really acquire that source and reach the
metadata refusal. Require exit 1, no npm, no state save or registration, no
accepted receipt, and preservation of any prior selected state. Do not mock
candidate verification, receipts or publication to unconditional success.

Freeze the new fixture, source tree and hashes before its first result. Run it
against the unchanged production baseline first. Expected: helper has one
semantic failure; the candidate control already passes with zero unsafe
activations. Setup, compiler, dependency, unreached-fault or isolation failures
are inconclusive. Do not count them as a red or change the original oracle.
Preserve both baseline receipts before implementation.

## Proposed repair boundary

The helper may return its existing `ran: false, ok: false` result plus the
optional literal `refused: 'invalid-package-metadata'`. It must not throw for
this input or start npm. `prepareCandidate` must explicitly reject that result
before entrypoint detection or publication. Keep the actual fresh-attempt
guard before package reads. Keep namespace, receipt and owner checks intact.
No generic catch, silent skipped-build fallback or accepted invalid candidate
is permitted. This prediction authorizes no implementation by itself.

## Runnable measurements

Run in the selected MCP candidate checkout, with qualified task-owned
dependencies. The first command retains the existing unit unchanged. The
second names the new boundary control after its fixture is frozen:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git.test.ts -t 'returns early when package.json is malformed JSON'
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git-install.test.ts -t 'refuses invalid package metadata before publishing a tracked entrypoint'
```

Then run all related cohorts, retaining the original cases and the separately
reported added safety controls:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git.test.ts src/mcp/mcp-git-install.test.ts src/mcp/mcp-git-entrypoint-files.test.ts src/mcp/git-candidate-env.test.ts
JOBS=1 heavy-run env NO_CACHE=1 npm run verify
```

Success: 0/1 helper throw failures; 0/1 unsafe candidate activations both before
and after; zero npm calls for invalid metadata; zero setup failures; all
retained 54 units, two ownership guards, real-Git 51, counter and related
controls green; and the current-main required full gate green with
`NO_CACHE=1`. The new boundary control is additional, not part of the original
51 denominator. A full-gate cache or stale installed dependency is not proof.

Pivot: any helper failure, unsafe activation, npm execution, changed original
oracle, weakened ownership/receipt refusal, mutated old runtime, raw payload
disclosure or related regression rejects this approach. Preserve the actual
failure and reassess the boundary; do not broaden catches or raise deadlines.

Anchors: Basili, Caldiera and Rombach (1994), *Goal Question Metric*;
Munafò et al. (2017), preregistration; the retained helper assertion and the
candidate's fail-closed publication contract.
