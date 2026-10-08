## Patterns That Pay Off

- **Catalog version-pinning matters.** If a source repo is fetched
  but the catalog yaml doesn't pin to a SHA or release, the
  user is effectively running `main` of an external repo. Note
  unpinned sources separately from outdated ones — they're a
  supply-chain risk class, not just a freshness issue.
- **Don't propose skills you can't read.** Always fetch and read
  the candidate's SKILL.md before proposing installation. Half-
  finished skills are common in low-star repos.
- **Look for "categories I have nothing for".** Inventory the
  topics your existing skills cover; if a popular topic (testing,
  observability, deploy) is sparse, that's a discovery prompt.
- **Trailofbits/skills updates are the most reliable signal.**
  When that source gets a new skill, it's usually a real production-
  quality addition — bias discovery toward checking that source
  first.
- **The user's gitignore patterns matter.** Just like `companion-
  docs-sync`, check `git check-ignore` on any file you propose
  to write. Some users gitignore `docs/skill-curation/` — file the
  report to `/tmp/` instead and reference it inline in the TASKS.md
  entry.

## Cool-down

After running once per workspace, mark cooled for 7 umbrella-loop
cycles (i.e. seven iterations of `companion-researcher`'s Phase 2
PICK LANE step on this workspace — not seven wall-clock days). Skill
catalogs don't change that fast, and re-running will mostly repeat
findings until the worker has acted on them. The umbrella tracks
cool-down state per `(repo, lane)` pair; for this lane the "repo"
key is the workspace itself, not any individual sub-repo.
