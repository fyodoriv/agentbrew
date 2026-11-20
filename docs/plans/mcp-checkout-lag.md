# Show known lag in Git-backed MCP checkouts

## Registered experiment

Goal: make a stale checkout visible before it surprises a skill user.
Question: can verbose status identify a checkout behind its saved
upstream without changing the checkout? Metrics: correct verdicts,
network-free Git commands, and pre/post file and ref bytes.

Hypothesis: a checkout whose local branch is an ancestor of its saved
upstream has lag that verbose status currently misses. One bounded
read of the saved refs can expose the number of missing commits.

Measurement: run `heavy-run npx vitest run src/mcp/git-checkout-lag.test.ts src/status.test.ts`.
Use scratch Git directories for behind, current, diverged, detached,
missing-upstream, and symlinked controls. Verify that no fetch or checkout
runs. Compare the checkout's test file and Git refs before and after.

Success: one behind verdict in the behind case and zero false behind
verdicts in the other five cases. Zero checkout or ref writes and zero
fetch operations. Show each known lag in `agentbrew status --verbose`.

Pivot: any false verdict, write, network request, output of a remote URL,
or operation outside the managed cache rejects the approach.

Anchor: [Agentbrew issue #1167](https://github.com/fyodoriv/agentbrew/issues/1167),
`src/mcp/mcp-git.ts`, `src/mcp/git-ref.ts`, `src/status.ts`, and
the [Git environment contract](https://git-scm.com/docs/git#_environment_variables).

This check only compares saved tracking refs. A checkout with old tracking
refs can be behind the live remote. The report does not certify remote
freshness or pull a checkout used by a running MCP server.
