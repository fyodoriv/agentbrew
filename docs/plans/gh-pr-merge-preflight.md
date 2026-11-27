# Verify PR readiness before a merge starts

[Dotfiles #736](https://github.com/fyodoriv/dotfiles/issues/736) asks
for a check before the shell runs a GitHub merge. Agentbrew already
owns the shared PR command parser. Its Stop hook only checks after
a tool call and deliberately allows pending or unavailable evidence.
Add an opt-in pre-tool check. Keep the Stop and reviewer-request
routes and the server-side branch protection.

- **Hypothesis**: The pre-tool check refuses an explicitly targeted
  merge unless the current PR head and its completed checks match
  the requested merge.
- **Measurement**: Run hosted `npm exec -- vitest run src/hooks/manifest.test.ts --maxWorkers=1`
  and `bash hooks/checks/pr-merge-preflight.test.sh`. Use fixture
  GitHub CLI responses for completed success, skipped and neutral
  checks, one legacy success, pending, failed, behind, conflict,
  missing checks, malformed output, timeout, and head mismatch.
- **Success**: The actual manifest routes 1 enabled pre-tool hook.
  Allow the 2 supported explicit target forms only for the
  matched ready head. Refuse every unverified fixture with 0
  merges and at most 1 read each. Unrelated input makes 0 reads.
- **Pivot**: At least 1 non-ready approval, wrong target, unbounded
  probe, changed Stop result or attempted merge rejects the change.
- **Anchor**: [GitHub CLI merge contract](https://cli.github.com/manual/gh_pr_merge),
  [PR status fields](https://cli.github.com/manual/gh_pr_view),
  and the existing Dotfiles exact-head delivery gate.

Support a standalone merge named by an explicit PR number and
host-qualified github.com repository or a canonical github.com HTTPS
PR URL. Resolve the host before the probe. Require the full expected
head SHA as the host-side merge precondition. Classify empty or
invalid check lists as unavailable. Keep the status query bounded
and read-only. Treat unsupported merge shapes conservatively.
Do not activate a new hook on the live machine in this phase.

The [hosted Linux baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44903297727/job/136843541800)
found no configured pre-tool match when the overlay explicitly
enabled it. The existing Stop, manifest and reviewer controls passed.

GitHub CLI can send enterprise credentials to a non-public host.
Reject unqualified repositories, other hosts and implicit host
selection before making a query. Use the explicit public host
in the query so an ambient setting cannot redirect the read.
[GitHub CLI environment](https://cli.github.com/manual/gh_help_environment).

## Keep the fixture on its private GitHub CLI

- **Hypothesis**: Configure the test process so endpoint path setup keeps
  its fake GitHub CLI first, even on a Mac with a Dotfiles checkout.
- **Measurement**: From an owner-like shell, run
  `bash hooks/checks/pr-merge-preflight.test.sh` with a regular Dotfiles
  checkout available. Read the fixture's read-count and merge assertions.
- **Success**: All 20 fixture rows pass, the numbered ready PR makes exactly
  one fixture read, and every row makes zero real GitHub or merge calls.
- **Pivot**: If any row fails or the real CLI can outrank the fixture, stop
  before delivery and isolate the test subprocess more narrowly.
- **Anchor**: The numbered-ready control reproduced exit 2 instead of 0 on
  the owner Mac. Loading endpoint paths moved the fixture CLI out of first
  place. The companion `a-pr-is-not-ready.test.sh` sets a private Dotfiles
  directory for its test subprocesses.
