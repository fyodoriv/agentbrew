# Targeted skill refresh prediction

An existing catalog skill can remain stale because install skips the staging
copy. The broad skills pull can update other sources and prune skills; its
dry-run does not preview the prune. The global goal rule is active, but the
installed goal workflow is still an older managed snapshot.

- **Hypothesis:** A named refresh can update one owned skill from its source
  while leaving all other installed skills and source checkouts unchanged.
- **Measurement:** Run focused command and filesystem controls, then hosted
  CI. Refresh the goal workflow and compare its installed bytes to the merged
  source and its agents' deployed targets.
- **Success:** At least eight controls cover unique ownership, ambiguous or
  missing ownership, offline fetch, dirty cache, rollback, unchanged source,
  and unrelated skill preservation. The named copy matches its source; zero
  unrelated copies or source checkouts change.
- **Pivot:** If ownership is ambiguous, the checkout is dirty, the source
  cannot be fetched, or another skill changes, refuse the refresh and retain
  the previous snapshot. Do not silently prune or use the broad updater.
- **Anchor:** `src/catalog/install-skill.ts`, `src/update.ts`, and the
  2026-11-13 run-goal sync/install observation.

## Design constraints from review

The current CLI has no supported one-skill refresh. Its broad pull can prune
other skills, and its existing copy helper deletes the old staging tree before
copying. A safe operation needs one verified owner, a pinned source tree,
bounded reads, a shared destination lock, a recoverable staging journal, and
verified existing agent links. It must preserve user edits and unrelated
skills. Two directory renames alone are not crash-atomic. No targeted
replacement has been performed.
