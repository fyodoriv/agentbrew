# Check npm package integrity before CI installs dependencies

- **Hypothesis:** The hosted gate will refuse an npm lockfile that records
  new integrity bytes for a package at an already locked version.
- **Measurement:** Run the new Node command on two real Git lockfile
  snapshots. Exercise same-version flips, a removed hash at the same path,
  scoped and moved packages, a version bump, regular additions and
  removals, and an unreadable baseline. Check the tracked lockfile and
  verify the workflow runs the command before `npm ci`.
- **Success:** All planted same-version changes exit 1 and name the
  public package identity. Both malformed input cases exit 2. The version
  update, the additions and removals, and the real checked-in lockfile
  exit 0. No digest is printed.
- **Pivot:** More than one false block in 20 dependency PRs triggers
  review of the comparison and its package identity rules.
- **Anchor:** `lockfile-integrity-flip-check` in Agentbrew's task queue
  and the archived Minsky lockfile classifier. npm stores package
  locations and versions separately, so the adaptation compares resolved
  package identity across locations.

This change covers Agentbrew. The separate tasks.md repository still needs
its own delivery and remains in the task queue.

## Scratch evidence

The same-version flip, removed digest, and moved scoped alias each exited 1
and named the affected package without printing a digest. The version bump
and the unchanged base with local and bundled records exited 0. An unknown
base and an incomplete lockfile exited 2. The checked-in Agentbrew lockfile
passed against its current base. Replacing one locked location's hash with
a hash already known at a second location also exited 1. So did replacing
the hashed record with a local link to the same named version. Malformed roots,
unresolved local links, and invalid UTF-8 each exited 2.

## Hosted baseline correction

Ubuntu run `44569804661` reached the integrity step and install, then
failed the workflow safety assertion at `src/docs/ci-workflows.test.ts:42`.
The assertion rejects GitHub event expressions used outside job controls.

- **Hypothesis:** Deriving the PR baseline from the first parent of the
  verified checkout keeps it exact and removes the workflow expression.
  A push can read its previous commit from the runner's event file after
  validating the commit IDs and checking the current head.
- **Measurement:** Replay the same workflow safety test on the old and new
  sources. Run a two-parent PR merge and a multi-commit push in scratch
  Git. Reject a mismatched head and invalid push data.
- **Success:** The existing assertion passes without a change to its rule.
  The PR uses parent one, the push uses its before commit, and all invalid
  controls exit 2. The hosted integrity step still runs before install.
- **Pivot:** Reject this approach if either event admits an unverified head
  or the comparison silently falls back to a moving branch.
- **Anchor:** Run `44569804661` checked out the GitHub PR merge ref. The
  existing workflow safety test protects the boundary.
