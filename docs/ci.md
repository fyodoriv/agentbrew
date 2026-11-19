# Hosted CI

GitHub Actions runs the gate for `fyodoriv/agentbrew`, so a pull request no longer depends on one machine.

## What runs where

| Check | Hosted runner | Your machine |
|---|---|---|
| Full gate, `npm run verify` | Every pull request to `main`, every push to `main`, and by hand (`gh workflow run ci.yml`) | Only when Actions is off, or to reproduce a hosted failure. Iterate with `npm run verify:changed` |
| Rust inventory core | Pull requests changing the shared core or its workflow | Runs focused offline Rust controls |
| `oss-readiness` (no-internal-refs test, private-email check) | Every pull request and push to `main` | Part of `npm run verify` |
| Private-pattern leak gates (pre-commit, pre-push, `gh` guard) | Never | Always |
| Version bump (`auto-publish.yml`) | Only by hand, only on `main` | `npm run release` |
| Build check on a `v*` tag push (`publish.yml`, read-only) | Every tag push | Not needed |
| npm publish | Never | By hand, with 2FA |

## What the hosted gate does not cover

- **Leaks.** The private-pattern file is not on the runner. Run the local leak check before every push.
- **Tools the runner lacks.** The runner has no `ai-rules` CLI and no agent CLIs. Tests that need them accept the documented skip there. A change to delegated rule sync (`src/sync/rules-delegate.ts`) still needs `npm run verify:changed` on a machine with `ai-rules`.
- **Linux image.** The Linux job uses `ubuntu-latest`. Keep the pinned Playwright version compatible with the runner image.

The build preflight compares installed package versions with the tracked
lockfile before running the build. It refuses missing or incomplete npm
comparison data. A declared optional package can be absent, and checked-in
local package links must still point to their recorded targets.

## Step cache (like nx)

`scripts/verify.sh` records steps that pass, keyed on their inputs. Reuse in
GitHub Actions is limited to the same runner image name, image version and
architecture. If the runner does not report all three, the hosted cache
restore and save are skipped.

The source-only artifact and task-stability lints can reuse a pass across an
unrelated docs change. The artifact lint checks for a root artifact before
using a cached pass. The task lint checks the queue and allowlist and declines
cache reuse for untracked ignored inputs or unresolved file types. Tools that
read the installed dependency graph keep their current cache policy.

The last gate line reports `verify: passed; N of M steps from cache`. To run
every step, delete the entries with `gh cache delete --all`. This also removes
the browser cache.

## Tests run on hosted CI only

Run lint, typecheck and build on your machine. Push the branch and let hosted CI run the tests.

- The opt-in PreToolUse:Bash hook `block-local-tests` (`hooks/checks/block-local-tests.sh`) blocks a test run inside an agentbrew checkout: `vitest`, `npm test`, `npm run test*`, `npm run verify*`, `npm run check:oss`, `node --test`, `tsx --test`, `bun test`, `yarn vitest`, `playwright test`, `scripts/verify*.sh`, `scripts/run-hook-fixtures.sh`. It also catches them behind `xargs`, `find -exec`, `npx`, `npm exec`, `pnpm dlx`, `bash -c` and `eval`.
- It allows lint, typecheck, build, `shellcheck`, one hook's own `.test.sh`, and every command outside an agentbrew checkout.
- Turn it on: add `block-local-tests` under `enabled:` in your hooks overlay, then `agentbrew sync`.
- Opt out: `export AGENTBREW_ALLOW_LOCAL_TESTS=1` before the agent starts. Setting it inside an agent command does nothing: the hook reads its own environment.
- It is a guardrail, not a security boundary. A command name built at run time (`$(which vitest)`) passes. `npm run verify:build-pipeline` (a build check) is allowed. The session folder always counts, so `cd ~ && npx vitest` started in a checkout is blocked too.

The clean health-check fixture in `src/integration.test.ts` deploys its own
commands and hooks. You can filter it by its test name to check it in isolation.

## Cache measurements

Measured 2026-11-16 from `gh run view --log` and the jobs API on `ci.yml` runs: 10 warm `main` runs (2026-11-15 to 11-16) and the cold runs of 2026-11-10 (the first `main` run and the `ci/hosted-gate-on` PR runs, before any entry existed). Each cell is the median seconds the cache touches: restore + save + the work it saves.

| Cache | What the time covers | Ubuntu cold | Ubuntu warm | macOS cold | macOS warm | Verdict |
|---|---|---|---|---|---|---|
| npm (`setup-node` `cache: npm`) | setup-node + `npm ci` | 26 (n=1) | 28 (n=16) | 26 (n=4) | 41 (n=13) | **Removed**: no gain; restoring ~0.5 GB costs more than `npm ci` downloads |
| Playwright browsers | cache step + its save + `playwright-install` | 8.9 (n=3) | 4.7 (n=14) | 11.7 (n=4) | 7.3 (n=13) | Kept: saves ~4 s per job |
| Gate step cache | `hook-fixtures` step (+ ~2 s restore/save) | 37 (n=3) | ~2 (n=16) | 71 (n=4) | ~2 (n=13) | Kept: saves 35-69 s per job |

Re-measure after a lockfile or workflow change; drop a cache whose warm median is not below its cold median.

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

## Flake detection thresholds

A flaky gate trains people to ignore it. Detect flakes from run history, not
by feel.

- Read the last 100 runs of a workflow. Find same-SHA pairs where a job failed,
  then passed.
- Report a job when its flake rate is at least 10% over at least 5 same-SHA
  pairs. 10% is the empirical mark where a team learns to ignore a gate
  (Memon et al., 2017; Forsgren, Humble, Kim, *Accelerate*, 2018). Under 5
  pairs, a high rate is noise.
- Keep both numbers as named constants so a test can pin them.
- Run the detector as a non-blocking job. A detector that fails the build on
  every hit becomes a flaky gate itself.
- For each hit, write a task block with the fix hypothesis. If the root cause
  takes more than a day, downgrade the job to non-blocking and file a
  follow-up.

## Test timeout check

The gate runs `node scripts/check-vitest-timeouts.mjs` against the
`origin/main` merge base. Pass a different base ref for another branch.
Use a named constant for a new numeric timeout in a Vitest `it` or `test`
call. The check compares test names and values against the base, including
renames detected by Git. It keeps established deadlines and global defaults.
Its scope is ordinary source test cases. Shell, subprocess, polling, fixture
and separately scheduled tests retain their own timeout controls.

**Hypothesis.** A syntax-based check can flag new inline deadlines in Vitest
test calls while preserving existing deadlines and unrelated fixture values.

**Measurement.** Run the timeout lint fixtures and compare change-base results
for positional, options-object, and parameterized test cases. Use the
repository gate after checking a named constant and an unchanged legacy deadline.

**Success.** Flag all three inline-deadline forms and zero normal controls.
Preserve both global 30-second defaults. A title-only edit must keep an
existing deadline. A same-titled test in a different suite cannot inherit
that deadline. A .prep.test.ts filename alone does not exempt a test. Fail
when the change base or source cannot be read.

**Pivot.** Any false block on an unrelated edit or an eligible existing
deadline rejects the gate design.

**Anchor.** [Vitest test API](https://vitest.dev/api/test) and the existing
flake tracker task's one seeded literal control.

## Merge rule

Merge only when every hosted check on the pull request is green. Never merge on a pending or red check. Wait with `gh pr checks <n> --watch`.

## When a hosted check fails

1. Read the log first: `gh run view <run-id> --log-failed`.
2. Reproduce it locally with the failing step's command.
3. Fix the cause. Never push an empty commit to start the run again.

## Turn it off or on

This is a repo setting; the owner decides.

- Off: `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions -F enabled=false`. `npm run verify` on your machine is then the only gate again.
- On: `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`, then `gh api -X PUT repos/fyodoriv/agentbrew/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`.
