# P0: quiet external waits and canonical goal metrics

Register before regression or skill edits. The owner requested P0 on
2026-11-05. Scope is the existing run-goal workflow, its references and evals.
Do not clear or pause the active tooling goal, change a live financial app,
send another chat a message, or copy private session content into fixtures.

## Problem and hypothesis

The reported incident contains four duplicate waiting replies while the same
CI state remains pending. The goal evaluator also reasons from an obsolete
metric window. Predict duplicate_wait_replies=4 -> 0 in the fixed incident
trace; duplicate_watchers=0, wrong_metric_verdicts=0 and false_goal_mutations=0.
These are outcome checks, not counts of added instructions or test cases.

The existing skill lacks an explicit native-background CI handoff and a
canonical metric tuple propagated to checker evidence. Add those procedures
behind capability probes. Do not build another scheduler or pretend to patch
closed native evaluator code.

## Frozen scenario obligations

Use synthetic data, not the owner's values, repository or PR number.

- Pending CI repeats: unchanged observations retain one exact owned watcher
  and produce no repeated waiting reply or final-response loop.
- Success: one terminal notification causes an authoritative result read for
  the same repository, PR, head and run attempt before approved delivery.
- Failure/cancellation: notify and inspect; do not merge or claim success.
- Replaced head/run: the old completion cannot qualify the new target.
- Missing/expired watcher: reconcile its actual state before replacing it;
  missing evidence stays unknown, never falsely armed or completed.
- Metric correction: the selected quarter-window score is 18 percent and
  the obsolete monthly score is 37 percent. For an explicit <=20 percent
  criterion only the selected quarter value qualifies. With >=20 the same
  selected value does not qualify. Missing comparator stays unverified.
- Shipping remains required when present in the original request, even if
  the chosen numeric criterion already passes. An armed watcher is not done.
- Missing native condition-update/wait capability: retain the canonical
  contract and report the exact unsupported binding; do not invent fields,
  mutate host storage, spoof user origin, pause, block or clear as a workaround.

The metric tuple is definition + query/source + window + denominator + unit
+ comparator + threshold + latest user-authorized revision. Preserve raw
goal text separately. Update dependent artifacts and print a self-contained
checker-facing criterion after a user clarification. Only an acknowledged
supported native operation and readback can establish native synchronization.

## Measurement and interpretation

```sh
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-external-waits.test.ts --maxWorkers=1
```

First establish missing-contract/fixture RED against unchanged guidance,
then preserve assertions while implementing the route. Static source and
fixture checks establish guidance coverage only. An independent forward
evaluation must exercise the scenario decisions and report its action trace;
never relabel static matches as reduced native model invocations.

For native integration, qualify only capabilities actually available in the
host. A bounded isolated Claude canary may establish registered background
completion and evaluator deferral; record unavailable or failed setup rather
than claiming a live pass. No account/privacy/hook settings changes, live PR
mutations, private transcript import or paid-provider model override are part
of that canary. Native Codex idle deferral is not exposed in current tools;
use a supported wait within the turn and name the limitation honestly.

Success requires every declared scenario, the independent review, and normal
repository gates. Any unsafe state mutation, stale verdict, duplicate watcher
or unverified notification rejects the route. Do not weaken thresholds or
replace an end-state criterion with waiting. Keep SKILL.md within its existing
budget by routing detailed instructions to the reference.

## Primary capability evidence

- [Claude goal behavior](https://code.claude.com/docs/en/goal): native
  background tasks defer evaluation and completion resumes the session.
- [Codex 0.166.0 model tool schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/ext/goal/src/spec.rs):
  current update operation changes status, not objective or wait state.
- [Codex host objective-update schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoalSetParams.ts):
  a host capability is not proof that this session exposes an accepted tool.

Anchor: Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration. Estimate: active effort 1 / 3 / 6 hours low/likely/high,
plus shared-queue and gate time. Primary uncertainty is native canary access;
report progress and revise the estimate when evidence changes it.

## Qualification record

The initial guidance/fixture guard failed all six cases before implementation
and passed all six afterwards. Independent review then found the older worker
watchdog still inferred job death from transcript silence. A seventh guard
failed against that contradiction, then passed after the quiet-wait exception.
The first changed gate passed 620 tests; later edits require a fresh gate.

Independent baseline simulation already chose quiet native waiting and the
correct selected metric. Its missing-handle recovery could duplicate a live
job. Therefore this experiment does not establish a causal four-to-zero
reduction in live replies or model invocations. The new fixture measures
specified decisions, not native scheduler behavior. Keep that distinction in
delivery evidence and any later field measurement.

Native condition amendment remains capability-gated. Codex host scheduling
and unavailable tools are not changed by this skill. A bounded native Claude
canary is separate from simulated action traces; setup failure or missing
deferral evidence cannot qualify it.

The final frozen candidate passed the uncached full gate: 6,275 tests passed,
33 legacy tests skipped, 414 files passed and two files skipped. All twenty
verification steps ran fresh; installer e2e correctly skipped because no
installation path changed. Frozen source hashes were unchanged at completion.

A bounded isolated Claude canary exited zero before its 120-second deadline.
Target-bound metadata confirms one accepted background handle, the initial
turn ending before its completion, one owned native completion notice, and
then a marker read. It retained configured memory and hooks, with an
invocation-only `dontAsk` permission mode and exact command allowance; no
account or permission settings were written. This proves native handoff
capability, not that the revised skill reduced evaluator calls. No real PR
or other session was changed, and no raw private transcript is published.

The implementation task is complete as a workflow correction. Live evaluator
invocation savings remain unqualified; future field evidence must retain that
separate outcome and the original acceptance criteria. No unsupported native
condition synchronization or Codex idle scheduling is claimed.
