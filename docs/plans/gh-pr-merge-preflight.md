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
repository or a canonical HTTPS PR URL. Require the full expected
head SHA as the host-side merge precondition. Classify empty or
invalid check lists as unavailable. Keep the status query bounded
and read-only. Treat unsupported merge shapes conservatively.
Do not activate a new hook on the live machine in this phase.
