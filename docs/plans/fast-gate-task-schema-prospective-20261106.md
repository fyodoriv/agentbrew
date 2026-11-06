# Fast gate: prospective task-check experiment

## Overall goal and vision

A task-only change must not receive a merge-ready verdict when its task
schema, conflict markers or Git whitespace check fails. Reuse the full
gate's pinned parser and Git's existing check. Keep the source/full routing
policy and owner security controls.

## Decision and alternatives

Start a new prediction before new fixture or product edits. Keep every
original input byte sequence. Treat the formerly valid-labeled empty bytes
as a whitespace negative in this new registration, then add a separate
format-clean edited empty queue as the second positive. Do not edit the old
registration or reinterpret its outcome as success.

Reject changing `git diff --check` to ignore EOF whitespace. That would
weaken an explicit original requirement. Reject silently replacing the old
empty bytes. That would change the old experiment after its result.

## Evidence and current state

| Claim | Source of truth | Delivery path | Status |
|---|---|---|---|
| The original prediction requires raw Git checking and two valid controls. | `885a127:docs/plans/fast-gate-task-schema.md` | Real verification shell script | fact |
| The original candidate run failed on `TASKS.md:4: new blank line at EOF`; sixteen other focused tests passed. | Retained terminal GREEN transcript and result receipt | Original execution fixture | fact |
| The original empty input label was wrong under its own Git rule. | Original frozen input SHA below and the failing Git diagnostic | Original experiment | fact |
| Successful observation rows were omitted from the old transcript. | Retained GREEN transcript and pinned Vitest reporter source | Observation driver | fact |
| The new matrix will reject every invalid input and retain both valid inputs. | Seven decisions below | Future execution fixture | proposed |
| The explicit reporter mode will emit seven complete observation rows. | Pinned CLI help and reporter source; must still be proved by a run | Future observation driver | verify |

The original experiment is **failed**, including its valid-control pivot.
The driver also ended with incomplete parsed observations. Neither condition
is a green result. Original labels, inputs, logs, frozen oracle and driver
receipt remain historical evidence. This document registers a new experiment.

## Scope and boundary

Only `scripts/verify-changed.sh`, its execution fixture, this registration and
the matching task/docs are in scope. Mutable fixture files belong to one
test-case scratch repository. Keep all original routing/reader tests, their
timeouts, assertions and success policy. The strict parser stays the actual
offline cached `@tasks-md/lint@0.10.2`, with its matching parser package.
Unrelated checks may use successful fixture stand-ins. No owner data or
network access is needed.

## Frozen prospective decisions

Each case edits a tracked scratch `TASKS.md` after the same clean baseline.
The first six full byte sequences are retained unchanged from the failed
experiment. Their hashes below bind the bytes, not a successful result.

| Input | Expected decision in this new experiment | SHA-256 |
|---|---|---|
| Original orphan fields | Refuse before downstream work | `4277426a83e9a14b60d9a5af5161e28bb4cb270ec79e1a1b64565bd19ca873b4` |
| Original duplicate IDs | Refuse before downstream work | `fd43f174bdcd5d1302ef937bf6adccc83a8ebd5016ee393845ac25c36e99a572` |
| Original missing P1 hypothesis | Refuse before downstream work | `8eefb6c5b2e2ba87de33f7f5f2cb8fc2eb1b8ec4f23c9f2b48201aa0b5d9c980` |
| Original conflict markers | Refuse through raw Git check | `4b5066fcf1d06adbc5f97288253665ddaf6187d16bf07fae3ef11390a5990015` |
| Original complete task | Approve; invoke strict parser | `8c67a904df237691504c4648727e49d67ecf619350485644e048e40846ba9973` |
| Original empty bytes, now explicitly an EOF-whitespace negative | Refuse through raw Git check | `982b735b924b52c5c85d1e592eb94bf1e20575c1cf13cd3b1451ba8cb05b65b1` |
| New format-clean edited empty queue | Approve; invoke strict parser | `ba09856d9bc06e3a77d4e068ade0403b442f557d6b46992a1a5ced7010efbb88` |

The last input is exactly the UTF-8 string
`"# Tasks\n\n## P1\n\n## P2\n"` (22 bytes). The original EOF negative
remains exactly `"# Tasks\n\n## P1\n\n"` (16 bytes). Both are edits
against the original clean baseline `"# Tasks\n\n## P1\n"`. Do not
trim or normalize any fixture text.

## Hypothesis, measurement, success and pivot

**Hypothesis (GQM):** adding the already registered raw Git and pinned parser
checks reduces invalid-input false approvals from five to zero across the
new five-negative/two-positive matrix. Both valid controls remain approved.
The old baseline was observed for six old inputs; the new seven-case
baseline and its predicted five false approvals still need measurement.

```sh
JOBS=1 heavy-run npm exec -- vitest run src/verify-changed.test.ts --maxWorkers=1 --reporter=default --silent=false
```

The pinned Vitest 4.1.12 CLI supports both options. Its agent reporter maps
to `MinimalReporter`, which sets `silent: "passed-only"`; the default
reporter does not impose that setting. Use both explicit options in the
observation command. This changes evidence visibility, not fixture outcomes,
assertions, deadlines or production behavior. Do not infer success from
missing rows or change the old retained transcript.

Record exit status and exactly one row per input: decision, strict-parser
argv, downstream sentinel and merge-ready output. Both Git negatives must
fail with their specific Git diagnostics before the parser. The other
negatives must fail after invoking the exact strict parser. Positive cases
must invoke that parser and reach the unchanged downstream success path.

**Success:** all seven decisions are correct; invalid approvals are zero of
five; valid approvals are two of two; negative downstream executions are
zero; all eleven original tests remain passing, for eighteen focused tests
in total. All seven observations and actual terminal exits must be present.

**Pivot:** any invalid approval, valid refusal, changed old input byte
sequence, weakened check or synthetic replacement parser rejects this new
approach. Missing rows, setup failure or incomplete terminal evidence make
the run unqualified; preserve it and diagnose before another run. Do not
change a failed oracle after measuring it.

**Anchor:** the existing full task gate; [Git diff check](https://git-scm.com/docs/git-diff);
Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017), preregistration.

## Numbered work breakdown

### 1. Register before execution

- **Why:** keep the failed experiment and the new prediction separate.
- **Parallelism:** follows preservation of the failed candidate; no new test execution yet.
- **Owner / boundary:** agentbrew task and plan documentation.
- **Change:** compose current main, retain historical evidence, and commit this prediction after the required repository gate and independent review.
- **Evidence / acceptance:** only registration docs/task change; production script and test remain at their original baseline.
- **Verification:** inspect the diff and source hashes; run the required gate before the prediction commit.

### 2. Implement and measure after the prediction commit

- **Why:** prove refusal through the real shell boundary and real pinned parser.
- **Parallelism:** depends on step 1 and root authorization.
- **Owner / boundary:** invocation-owned execution fixture and existing verification script.
- **Change:** retain the six old byte sequences, add the clean empty control, freeze all seven new decisions, then run unchanged-script RED before adding raw Git and pinned parser checks.
- **Evidence / acceptance:** predicted RED is seven failed assertions plus eleven passes; GREEN is eighteen passes with all seven complete observation rows.
- **Verification:** the measurement command above, then independent review and the normal changed/full gates.

## Rollout, security and regression coverage

No new fixture implementation, product patch or measurement is authorized by
this draft alone. Commit the prediction first after a qualified gate. Do not
run another full gate while the existing owned full run is active. Preserve
all failed and unqualified records. Deliver only after the normal repository
gates, leak checks and independent review; keep full-gate routing unchanged.

Estimate: 30–60 minutes of active work, plus queue/gate time. The prior
estimate missed fixture-label and observation-mode errors. Include a
pre-execution check of input bytes against every declared rule and explicit
reporter configuration in the next estimate.

## Prospective experiment qualification — 2026-11-06

Prediction `6b825c2` was committed before this experiment. The original
experiment at `885a127` remains failed. Its frozen input bytes, labels and
failed transcripts were preserved. The prospective registration kept every
original byte sequence and added only the separately declared clean empty
queue. The original routing and reader test body remained byte-identical.

The command above ran with the explicit default reporter and console output
enabled. The unchanged-script RED ended with exit 1: seven failures and
eleven passes, with exactly seven complete observation rows. Only after that
terminal RED did the driver add the registered raw Git and pinned strict
parser checks. GREEN ended with exit 0: eighteen passes and exactly seven
complete rows. The frozen fixture/oracle hashes stayed unchanged throughout.

| Input | Before | After | Strict parser after | Downstream work after |
|---|---|---|---|---|
| Orphan fields | Approved | Refused, exit 1 | Invoked | None |
| Duplicate IDs | Approved | Refused, exit 1 | Invoked | None |
| Missing P1 hypothesis | Approved | Refused, exit 1 | Invoked | None |
| Conflict markers | Approved | Refused by Git, exit 2 | Not reached | None |
| Complete task | Approved | Approved, exit 0 | Invoked | Success path |
| Original EOF-whitespace input | Approved | Refused by Git, exit 2 | Not reached | None |
| Clean edited empty queue | Approved | Approved, exit 0 | Invoked | Success path |

Unsafe approvals fell from five to zero. Both valid controls remained
approved. Invalid inputs reached neither the downstream sentinel nor the
merge-ready verdict. The fixture ran the actual cached pinned parser; only
unrelated successful checks were stand-ins. This proves the registered
verification boundary, not a new parser or a model-quality result.

Normal repository qualification is pending. The focused experiment does not
replace the full gate, independent review, leak checks or delivery.
