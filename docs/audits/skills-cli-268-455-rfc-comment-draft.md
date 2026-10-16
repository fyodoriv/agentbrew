# Draft: RFC comment on vercel-labs/skills #268 and #455

- **Task**: `contribute-rfc-comment-issues-268-455-user-safety-classifier`
- **Status**: draft, not posted. Posting is a public write on a third-party repo. The owner must approve that exact action.
- **Checked**: 2026-10-16. #268 and #455 are open. #606 is open. PRs #609 and #611 are open. #869 merged on 2026-04-27, but it preserves dotfiles inside copied skills; it does not classify user-created skills. #944 is closed. No PR has landed a user-skill classifier, so the comment is still useful.

## How to post (owner, one step each)

1. Re-check the states above: `gh issue view 268 -R vercel-labs/skills`, `gh pr view 609 -R vercel-labs/skills` (and 611).
2. Post the main comment: `gh issue comment 268 -R vercel-labs/skills --body-file <file with the "Comment on #268" text>`.
3. Post the short cross-link: `gh issue comment 455 -R vercel-labs/skills --body-file <file with the "Comment on #455" text>`.
4. Paste both comment URLs into the task block, then remove the task once a maintainer replies or a classifier PR merges.

## Comment on #268

> Design input, not another PR. Several open PRs (#609, #611) already touch this area, so this comment only shares a classification that has worked for us.
>
> agentbrew syncs skills into the same agent skill folders. Before it removes anything from an agent's skill folder, it classifies each entry into one of five cases:
>
> | Entry in the agent skill folder | Owner | Action on prune or repair |
> |---|---|---|
> | Symlink whose target is a known managed source path | tool | remove or relink |
> | Broken symlink (target missing) | tool | remove |
> | Symlink to a valid path that is not a managed source | user | keep |
> | Real directory without a tool sentinel file | user | keep |
> | Real directory with the tool's sentinel file (`.agentbrew-filtered` in our case) | tool | remove or rewrite |
>
> The invariant: the user's own files are kept forever. Prune, auto-repair, and sync all treat a user-created directory as off-limits. The tool only removes what it can prove it wrote: a symlink into its own source store, or a copy that carries its sentinel.
>
> For the skills CLI, the lock file could play the sentinel's role for copies, and the canonical `~/.agents/skills/` path the role of the managed source store for symlinks. An entry that is in neither is the user's.
>
> Reference implementation (about 20 lines): `cleanEntry` in https://github.com/fyodoriv/agentbrew/blob/main/src/sync/skills-sync.ts
>
> We are not filing a PR for this. We hope it helps whoever lands the fix.

## Comment on #455

> A short pointer for the `preserve-local` request: #268 now has a five-case classification of agent skill-folder entries (managed symlink, broken symlink, user symlink, user directory, managed copy with a sentinel). With it, `skills update -g` could keep every user-created entry by default, with no extra flag. Details and a small reference implementation are in https://github.com/vercel-labs/skills/issues/268. We are not filing a PR.
