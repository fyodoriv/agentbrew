# Check pre-registration at the pull request gate

- **Hypothesis**: Reusing the existing checker catches a missing pull request prediction and a new task with a manual measurement. A legacy task with unchanged text remains outside the new check, even if its section moves.
- **Measurement**: Run `npx vitest run src/skills/pre-register-checker.test.ts` on two bad inputs and three controls. Check a missing PR description, a new manual task, an unchanged legacy task, a revised runnable task, and a named exemption. Check the first 10 merged PR descriptions after activation with the command in the tracked task.
- **Success**: Two of two bad inputs fail. Three of three controls pass. The first 10 PR descriptions contain zero findings.
- **Pivot**: One unexpected fixture decision or more than two false blocks in the first 20 PRs rejects the current scope of the check.
- **Anchor**: Munafò et al. (2017), A manifesto for reproducible science, and the existing `preregistration-ci-gate` task.

## First field sample

The prediction check landed on Nov 20 at 07:30 UTC in [PR #1186](https://github.com/fyodoriv/agentbrew/pull/1186).

The first ten pull requests merged after rollout were #1192, #1193,
#1194, #1191, #1187, #1195, #1188, #1198, #1197 and #1200. Replaying
their current descriptions gives nine passes and one failure.
[PR #1192](https://github.com/fyodoriv/agentbrew/pull/1192) opened before
rollout, has no recorded description edit, and merged without a
prediction check. Three other descriptions were edited after merge.
The one confirmed failure already misses the target of zero.

The first twenty pull requests opened after rollout were #1194, #1195,
#1196, #1197, #1198, #1199, #1200, #1201, #1202, #1203, #1205, #1206,
#1208, #1209, #1210, #1211, #1212, #1213, #1214 and #1215. Each has a
successful prediction check on its exact sampled head. Four earlier runs
failed across three pull requests. Two found missing or incomplete
predictions. The other two found a missing source citation and a
nonnumeric pivot. The four logs show zero false refusals.

- [Missing prediction](https://github.com/fyodoriv/agentbrew/actions/runs/44739179647)
- [Missing threshold and source](https://github.com/fyodoriv/agentbrew/actions/runs/44739920687)
- [Missing source citation](https://github.com/fyodoriv/agentbrew/actions/runs/44777498197)
- [Missing numeric pivot](https://github.com/fyodoriv/agentbrew/actions/runs/44781070146)

The repository currently lists no required prediction status on the
default branch. A workflow pass therefore supplies evidence for a
specific pull request. It cannot enforce merge admission by itself.
Keep the original field result. The next observation requires a
repository merge requirement and a separately registered cohort.
