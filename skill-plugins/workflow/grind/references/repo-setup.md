# Make a repo grind-ready

Use this when the user asks to "set up grinding for this repo" or before the
first long unattended run in a new repo. Build the smallest setup that lets
the first pass ship work instead of rediscovering the repo.

## 1. Assess first

Read the repo's `AGENTS.md`, `README.md`, task queue, build and test files,
and recent commits. Note:

- **Queue health**: open tasks, blocked tasks, and the next task an agent can
  do alone.
- **Gate**: the real verify command (`make check`, `npm run verify`, ...).
- **Publish policy**: local commits only, branch + PR, or direct to main.
- **Risks**: credentials, personal accounts, paid services, production
  deploys, browser submits, outgoing messages.

A tiny repo may need only a queue and an `AGENTS.md` line. Add more only
for a real risk.

## 2. Commit one grind prompt

Write `.agents/grind.md` (or extend `AGENTS.md`). Keep it short enough to
read every pass. It holds:

- **Goal**: what a good run achieves in this repo.
- **Skip rules**: exact words for tasks the agent must skip, such as tasks
  that need the owner's credentials, personal data, paid sign-ups, or
  production approval. These override any "be fully autonomous" default.
- **Task choice**: how to pick among unblocked tasks.
- **Gate**: the command that proves a task is done.
- **Completion**: remove the whole task block in the same commit.
- **Source facts**: findings that prevent bad work ("sample X is rental
  data, not sales").
- **Lessons learned**: add only after a real run. No guesses.

Start the run from it: `/goal follow .agents/grind.md until <time>` or
`/loop /grind`.

## 3. Prove it before the long run

- The queue lints (`npx -y @tasks-md/lint TASKS.md`) or, without the linter,
  every task has a unique `**ID**` and blocked tasks carry `**Blocked by**`.
- One short pass ships one task and passes the gate.

## Don't

- Keep the prompt only in shell history; the next run loses it.
- Copy another repo's heavy guards (admin merges, deploy steps) without a
  matching risk here.
- Claim the repo is ready without the short pass above.
