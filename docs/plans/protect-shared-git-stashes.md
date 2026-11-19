# Protect stashes shared by linked Git worktrees

- **Hypothesis:** An opt-in Bash hook can stop direct Git stash discard
  commands before they erase recoverable changes from another worktree.
- **Measurement:** Feed synthetic JSON commands to the deployed check.
  Cover drop, clear, Git path and option variants, and read-only controls.
  Put a recording fake Git first on PATH and require zero calls.
- **Success:** All four supported discard cases exit 2. All five control
  cases exit 0. No test launches a Git command or changes a stash.
- **Pivot:** Reject the change if it blocks any registered read-only control,
  misses a supported discard, or executes intercepted command text.
  Review observed false refusals if they exceed one per week.
- **Anchor:** `block-remaining-dangerous-commands` and Minsky's archived
  shared-worktree rule. Git shares the stash reference across worktrees.

This slice checks a leading direct Git invocation. The other destructive
command shapes and expanded shell coverage remain open in the task queue.
