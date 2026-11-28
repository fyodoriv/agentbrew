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
   required check/run IDs, run attempt and current status. Use the published
   preview check name. Capture screenshots after it passes on the current
   head. Apply the existing disabled-CI check first so absent CI cannot
   become an indefinite wait.
2. Inspect an existing watcher before starting another. Reuse its accepted
   native task handle or attach a supported wait to its completion. A bare
   PID, queued task record, claimed auto-fix service or timer is not proof
   that this goal's evaluator will defer or receive a result.
3. If needed, launch one native background shell with the available tool's
   `run_in_background: true`. A GitHub CLI example: find the main workflow's
   run for the full head SHA with
   `gh run list --repo <OWNER/REPO> --workflow <name> --commit <full-sha>`
   (empty means it does not exist yet: wait and list again), then
   `bash ~/.claude/codeassist/hooks-scripts/lib/ci-watch-fail-fast.sh <run-id> --repo <OWNER/REPO>`.
   It ends on the first failed job (see "Act on the first failure" below).
   Do not wait with `gh run watch` or `gh pr checks --watch`: they return only
   when the last job ends, and the hook `background-suite-fail-fast` blocks them.
   A `gh pr checks <PR> --watch` started right after a push can exit green
   while only a fast side check is listed and the main run has not started.
   Record the accepted task handle, exact target, bounded deadline and next
   check event. Use the repo's existing timeout/wait facility; the command
   example alone does not establish a deadline. For a watch script, print the
   target it actually resolved on the first output line. Compare that receipt,
   or equivalent native handle metadata, with the planned repository, PR, head,
   check or run ID, and attempt. Require the observed identity. An echoed launch
   value leaves the target unverified. If the target is wrong or unknown, treat
   its event only as a wake-up. Read the intended target from the authority
   before trusting a result. Replace the owned watch only if it is wrong or dead.
4. Continue independent work. If only waiting remains, use the host route
   below. Unchanged observations produce no new user message or duplicate
   status reply, watcher, evaluator-facing completion claim or final-turn loop.
5. On completion, read authoritative results again before merging. Require
   the same current head and run attempt; a replaced head makes the old
   result stale. Keep original review, merge and installed-state requirements.
   An automated merge counts only explicit passes. Cancelled, skipped, timed
   out or missing counts as red. Merge only when this prints 0 and the list
   is not empty:
   `gh pr checks <PR> --repo <OWNER/REPO> --json bucket -q '[.[]|select(.bucket!="pass")]|length'`.
   Never test "green" with a negated text grep: one merged a PR whose macOS
   check had been cancelled at its time limit.

### Host forbids polling

When the host bans CI polling (no `gh --watch`, Monitor, cron or wakeup tool), do not
watch GitHub. Read the runner queue once (running and queued runs, their start times)
to size the wait. Then start one bounded background `sleep` with `run_in_background: true`
that never calls GitHub; its end wakes the session. Name the pending check in one reply.
On wake, read the PR once. A check still queued gets one new timer sized the same way.
`--required` waits on nothing when the base requires no checks. Then never enable
auto-merge: it would merge before the queued check ends.

### Local gates that end in a push

A local full gate can pause for minutes or hours (a load or memory guard
such as `heavy-run`). Never start a bare gate and plan to push "when it
ends": the push then waits for your next turn. Start one background job
that gates HEAD, checks both HEAD and the fetched PR base did not move,
then pushes and opens the PR only on exit 0. Stop any older gate on a stale
commit or base first, so the guard's queue frees resources. If the base moved,
integrate it and rerun the gate instead of publishing the old result. Run at most two full gates at once; hold
worktree agents beyond that. Merge stays a separate step after review.

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

## Act on the first failure

A full-run wait hides a failed job until the last job ends. On PR 1373 one
check had failed while the agent still waited. On 17 failed agentbrew CI runs
the hidden time was a median 84 s and a p90 582 s
(`bash scripts/ci-first-failure-lag.sh` in agentbrew). Use this loop:

1. **First failure.** The watcher exits 1 on the first failed job. It prints
   the job name, its link and its failed log lines. It never cancels the run.
2. **Fix.** Reproduce that failure locally and fix the cause. Do not push yet.
3. **More failures.** Run the same watcher command with `--rest`. It waits
   for the other jobs and lists every failure in one list.
4. **Fold or push.** Fold each listed failure into the same fix, then push
   once. If `--rest` lists nothing new, push the fix.

The watcher exits 0 only when every check passed, and 124 at its hard
timeout (`--timeout`, default 2700 s). In run mode its success line matches
`gh run watch --exit-status`, so `verify-before-completion` accepts it.
For local suites, use the runner's fail-fast flag (`vitest --bail`,
`pytest -x`, `--maxfail`), fix the first failure, then rerun once with a
higher limit to list the rest.

## Changes, failures and expiry

A watch that exits zero after a connection error has lost its
observation. Read the same run from the authority and resume a bounded
watch if the run is still active.

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

## A failure in one CI event type only

A step that fails in a pull-request run and passes in a push run of the same
commit (or the reverse) points at a tool that reads the event, not at your
code. List the tools the step starts and check what each does with
`GITHUB_EVENT_PATH` or `GITHUB_EVENT_NAME`. Example: Playwright 1.59 runs
`git fetch origin <base> --depth=1` in a pull request, which makes the
checkout shallow (off with `captureGitInfo: { commit: false, diff: false }`).
To find it, use a small throwaway workflow on a scratch branch that runs one
step per variant, not full gate runs; delete the branch after. Reproduce the
cause locally before the fix, and add a test that fails without the fix.

## Capability sources and proof limits

[Claude goal documentation](https://code.claude.com/docs/en/goal) describes
native background deferral, completion delivery and health check-ins.
[Codex's installed tool schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/ext/goal/src/spec.rs)
limits model-side goal changes. Discover actual available operations before
using them; an SDK type or host-only API is not proof of session access.

Fixture guards and forward evaluations test guidance and decisions. They do
not measure live evaluator invocations or establish unsupported host behavior.

## Liftable pauses

A pause the user can lift (an agent-usage guard, a rate limit with a reset
time) is a wait, not "impossible". Do not retry a refused agent spawn: each
retry counts as another refusal and can extend the pause. Ask once for the
lift command (for example `/agent-guard allow`), arm one background timer
for the stated reset time, and do every part that needs no agents meanwhile
(gate, PR, review prep). A button reply such as "Lifted, continue" is not
the command: check that the tool really runs before you report progress.
A refused pre-merge review spawn holds the merge too: a self-review does not
replace the fresh-context review, and a standing merge approval does not skip
it. Push and open the PR, then merge only after the review runs, its findings
are fixed, and a review of the fix finds nothing new (SKILL.md, Phase 5).
A guard cutoff is not the plan limit. In the same message as the first
refusal, tell the user the cutoff, the plan's real use from the refusal text
(for example "guard stops agents at 80%; Claude is at 84% of 100%"), and the
lift command, and put that command in the "Needed from you" line. Never
write "Needed from you: nothing" while the queue waits on a lift. A silent
wait at 84% held 7 merges for 8 hours (2026-11-08) while the user expected
only Claude's own limit.

## Outside this goal

- Open-ended goal ("fix all issues you see"): list the finite issues in the
  contract. Work you hand to another session or file as a task is outside
  this goal. Say so in the contract and in chat ("Outside this goal: <item>,
  owned by <session or task>"), and never list it under the goal's
  **Pending**. The checker reads the chat, and an item under Pending keeps
  the goal open.
- Same Stop re-fire, no new evidence: never send a second identical status.
  Act on the checker's reason once (finish the item, or move it outside the
  goal with an owner). If nothing changed after that, reply with one line.
  Twelve repeated "still waiting" replies cost tokens and changed nothing.
