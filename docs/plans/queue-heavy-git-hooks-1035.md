# Queue Git commands that run heavy hooks

**Hypothesis:** A pre-command check of the active Git hooks gives an agent
an explicit queue decision before both commit and push. The current guidance
names the heavy test command but misses a suite started by Git.

**Measurement:** Apply the run-goal eval for issue #1035 to four Git commands.
Check the local commit and push cases, a hook that already queues its work,
and a checkout whose policy requires hosted tests. Validate the fixture via
`npm run --silent skills:coverage`.

**Success:** 4 of 4 decisions preserve the repository's hook and test policy.
Both locally allowed suites enter the shared queue once. The hosted-only
case starts 0 local heavy suites.

**Pivot:** If 1 instruction would bypass a hook or acquire a second slot,
tighten the effective-hook check before shipping.

**Anchor:** [Agentbrew #1035](https://github.com/fyodoriv/agentbrew/issues/1035)
and the shared slot contract in Dotfiles `bin/heavy-run`.
