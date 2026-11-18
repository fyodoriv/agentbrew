# Prune verified merged worktrees

- Hypothesis: in a scratch repository, one clean merged worktree can be removed with zero losses of dirty, locked, unpublished or app-managed worktrees.
- Measurement: a hosted fixture creates disposable worktrees and reads the reported decision and before/after counts. Run the same command in preview to inspect the current inventory.
- Success: the preview changes zero worktrees. An explicit apply removes the one proven merge. Every other worktree is counted and kept with a reason.
- Pivot: any unknown origin state, unpublished commit, unclassified file or missing merge proof keeps the worktree.
- Anchor: `stale-worktrees-cleanup` and Git's worktree removal checks.

The fixture owns each worktree it creates. Live removals use a deliberate apply.
GitHub squash evidence has to name the current worktree commit and a merge
commit that is reachable from the current default branch.
