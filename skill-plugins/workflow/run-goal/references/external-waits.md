# Quiet external waits and metric binding

Use this when CI or another external event is the only remaining work, or
when the user clarifies a goal's metric. A waiting dependency is not proof
that the goal is complete or impossible.

## Bind the selected metric

Keep raw goal text separately from its latest user-authorized criterion.
Save definition, query/source, window, denominator, unit, comparator,
threshold and revision together. Do not infer the comparison sign from
"reach", or substitute the app's default window for the user's choice.

For example, a synthetic selected quarter score of 18 percent satisfies
an explicit <=20 percent criterion. It does not satisfy >=20 percent.
An obsolete month value of 37 percent is not evidence for either quarter
criterion. With no known comparator, leave the criterion unverified.

After a clarification, update the contract and dependent artifacts before
the next check. Print one self-contained checker-facing record:

```text
Criterion revision: <user-authorized revision>
Selected metric: <definition; query/source; window; denominator; unit>
Acceptance: <comparator and threshold>
Observed: <fresh value; source revision/time>
Metric verdict: <met|unmet|unverified>
Delivery criteria: <each original requirement and its separate verdict>
Native condition binding: <verified readback|unverified capability gap>
```

If an exposed supported operation can amend the native condition, use it
only for the user's authorized correction, then require accepted native
condition readback. A saved Markdown contract or a proposed condition is
not native synchronization. If the operation is unsupported, keep that
binding unverified; still present the canonical criterion in the conversation.
Do not invent a goal-update tool, edit host storage, or spoof user origin.

## Start or reuse an owned wait

1. Read the authoritative CI state once. Identify repository, PR, head SHA,
   required check/run IDs, run attempt and current status. Apply the existing
   disabled-CI check first; absent CI cannot become an indefinite wait.
2. Inspect an existing watcher before starting another. Reuse its accepted
   native task handle or attach a supported wait to its completion. A bare
   PID, queued task record, claimed auto-fix service or timer is not proof
   that this goal's evaluator will defer or receive a result.
3. If needed, launch one native background shell with the available tool's
   `run_in_background: true`. A GitHub CLI example is
   `gh pr checks <PR> --repo <OWNER/REPO> --required --watch --interval 60`.
   Record the accepted task handle, exact target, bounded deadline and next
   check event. Use the repo's existing timeout/wait facility; the command
   example alone does not establish a deadline.
4. Continue independent work. If only waiting remains, use the host route
   below. Unchanged observations produce no new user message or duplicate
   status reply, watcher, evaluator-facing completion claim or final-turn loop.
5. On completion, read authoritative results again before merging. Require
   the same current head and run attempt; a replaced head makes the old
   result stale. Keep original review, merge and installed-state requirements.

### Host routes

**Claude Code:** registered native background shell/subagent work defers goal
evaluation; task completion delivers a new turn. Use that native completion
route. Do not pipe repeated `gh --watch` progress into a Monitor: each stdout
line can become an event. A separate Monitor's presence alone does not prove
native goal deferral. If an existing external watcher cannot expose a native
completion handle, use a supported blocking subscription/wait to its result.

**Codex:** current tools expose status changes, not an objective-edit or
waiting status. Keep a supported blocking watch/session wait within the
current turn while it is the only remaining work. A detached process or saved
automation alone does not prove that native goal continuation is suspended.
Do not claim that a skill changes the host's evaluator scheduling.

Do not clear a goal, pause it, use blocked status as a CI-wait shortcut,
disable hooks, or append an "or watcher armed" success condition. A passing
metric does not finish a goal whose original shipping criteria are pending.

## Changes, failures and expiry

Keep one wait record owned by the goal invocation and target revision. Its
lifecycle ends on verified terminal completion, cancellation or replacement.
An expired/missing handle leaves liveness and notification unknown. Inspect
the existing job and authoritative CI before rearming; do not start a second
poller because a tool observation timed out. An observation timeout alone is
not job termination. Reconcile a changed target before replacing its wait.

A failed check wakes the worker to read the actual failure. Watcher/auth or
transport failure produces one diagnostic and a fresh investigation; repeated
identical errors are not new events. Report a genuine human-only step once,
then follow the host's existing blocked/pause rules. Do not pretend a failed
watcher is still armed. Keep private failure details in their existing owner.

Native health check-ins may still occur at the host's documented interval.
On one, inspect the existing handle rather than restart it. No changed state
means no duplicate waiting reply. Do not change account or check-in settings.

## Capability sources and proof limits

[Claude goal documentation](https://code.claude.com/docs/en/goal) describes
native background deferral, completion delivery and health check-ins.
[Codex's installed tool schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/ext/goal/src/spec.rs)
limits model-side goal changes. Discover actual available operations before
using them; an SDK type or host-only API is not proof of session access.

Fixture guards and forward evaluations test guidance and decisions. They do
not measure live evaluator invocations or establish unsupported host behavior.
