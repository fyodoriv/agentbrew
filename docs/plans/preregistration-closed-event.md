# Limit prediction checks to active pull requests

Agentbrew [job 136179287176](https://github.com/fyodoriv/agentbrew/actions/runs/44704107015/job/136179287176)
started on an edit after PR 1191 merged. Checkout loaded the landed
single-parent commit. The changed-task step expected a synthetic merge
with two parents and failed before comparing the tasks.

- **Hypothesis:** The job skips a closed PR event and a merged main ref without pull request state. All open or unknown merge-ref events keep the gate.
- **Measurement:** Run `npx vitest run src/docs/ci-workflows.test.ts` and evaluate the actual job condition with the published GitHub Actions expression library on the six registered payloads.
- **Success:** Both closed-event cases skip, all 4 active or unclassified events run, and the focused workflow and prediction tests pass.
- **Pivot:** Stop if 1 open or unclassified event can skip, 1 known closed event can enter checkout, or the existing two-parent task comparison changes.
- **Anchor:** The failed hosted job and [GitHub Actions pull request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

| Pull request state | Ref | Expected |
| --- | --- | --- |
| open | PR merge ref | run |
| open draft | PR merge ref | run |
| unavailable | PR merge ref for a fork | run |
| unavailable | unavailable | run |
| closed | PR merge ref | skip |
| unavailable | landed main ref | skip |

The check uses the state in the initiating event. An event queued while
the PR is open still has to pass the original gate. A later edit cannot
repair missing evidence at merge time.

## Protect checks queued while the PR was open

A job condition alone does not prevent a closed edit from entering
workflow-level concurrency. Move concurrency into the admitted job.
Use the PR number when provided and a separate run-ID group otherwise.

- **Hypothesis:** A skipped event does not compete with the admitted job, and 2 events with missing PR numbers cannot replace each other.
- **Measurement:** Run `npx vitest run src/docs/ci-workflows.test.ts` and evaluate the actual job group expression with the Actions expression library.
- **Success:** The workflow has 0 top-level concurrency groups. The 5 group controls preserve same-PR grouping, separate different PRs, and separate the 2 missing-number events.
- **Pivot:** Reject if 1 skipped event enters the admitted job group, 1 missing-number event shares another run's group, or same-PR edits stop replacing obsolete runs.
- **Anchor:** [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) and the named check's independent review.
