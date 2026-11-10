# Hosted CI

GitHub Actions runs the gate for `fyodoriv/agentbrew`, so a pull request no longer depends on one machine.

## What runs where

| Check | Hosted runner | Your machine |
|---|---|---|
| Full gate, `npm run verify` | Every pull request to `main`, every push to `main`, and by hand (`gh workflow run ci.yml`) | Before a merge, when `npm run verify:changed` does not say `merge-ready` |
| `oss-readiness` (no-internal-refs test, private-email check) | Every pull request and push to `main` | Part of `npm run verify` |
| Private-pattern leak gates (pre-commit, pre-push, `gh` guard) | Never | Always |
| Version bump (`auto-publish.yml`) | Only by hand, only on `main` | `npm run release` |
| Build check on a `v*` tag push (`publish.yml`, read-only) | Every tag push | Not needed |
| npm publish | Never | By hand, with 2FA |

## Cost and limits

- **Cost: zero.** Standard GitHub-hosted runners are free and unlimited for public repositories ([GitHub docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Never switch a job to a larger runner: those are billed.
- **Limits on the free plan** ([GitHub docs](https://docs.github.com/en/actions/reference/limits)): 20 jobs at a time, of which 5 on macOS; 6 hours per job; 10 GB of cache per repository, and an entry unused for 7 days is removed.
- A new push to a pull request cancels the older `ci.yml` run for that pull request.

## Safety rules

`src/docs/ci-workflows.test.ts` enforces these. Change the test in the same PR as a workflow.

- No workflow reads a secret. A pull request from a fork gets a read-only token.
- Every workflow sets `permissions`. Only the release job may write.
- Every action is GitHub-owned and pinned to a full commit SHA.
- No `pull_request_target`, `workflow_run`, or `issue_comment` trigger.
- No step prints the environment. The gate job sets `DO_NOT_TRACK=1`, so it sends no usage data.
- The private-pattern file is never uploaded. The local gates stay the authority for leaks ([`SECURITY.md`](../SECURITY.md)).

## When a hosted check fails

1. Read the log first: `gh run view <run-id> --log-failed`.
2. Reproduce it locally with the failing step's command.
3. Fix the cause. Never push an empty commit to start the run again.

## Turn it off or on

This is a repo setting; the owner decides.

- Off: `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions -F enabled=false`. `npm run verify` on your machine is then the only gate again.
- On: `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`, then `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`.
