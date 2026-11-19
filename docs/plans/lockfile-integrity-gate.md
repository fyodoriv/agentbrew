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
