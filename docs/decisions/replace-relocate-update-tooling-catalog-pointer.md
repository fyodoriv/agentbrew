# Decision: keep the update-tooling catalog pointer to dotfiles

- **Task**: `replace-relocate-update-tooling-catalog-pointer`
- **Date**: 2026-10-16
- **Status**: decided — keep the pointer; no catalog change

## Context

`src/catalog.yaml` has an `update-tooling` entry. It holds only a name, a
description, and `source: fyodoriv/dotfiles`. The skill text lives in dotfiles
`skills/update-tooling/SKILL.md`. agentbrew does not copy it.

The skill does four things:

1. Fetch every primary checkout under the tooling root. Fast-forward only a
   clean checkout on its canonical branch. Skip and report all others.
2. Advance the applied agentbrew checkout and rebuild it, then run
   `agentbrew sync --pull --no-recommended --agentfile ...`.
3. Refresh the chezmoi applied dotfiles checkout, run `dotfiles apply`, and
   reload the `com.dotfiles.*` LaunchAgents.
4. Run the health checks and rank the next tasks.

The question: can a generic upstream workflow replace the pointer, or take
over part of the skill?

## Options

| Option | Result |
|---|---|
| A. Keep the dotfiles pointer | No change. The catalog stays a curator. |
| B. Replace the pointer with an upstream skill | Users get a generic skill, but lose steps 2 to 4. |
| C. Contribute a generic part upstream | Step 1 could become a shared skill. Steps 2 to 4 stay local. |
| D. Move the skill into agentbrew | agentbrew would own machine config. VISION.md and AGENTS.md rule 8 forbid it. |

## Evidence (2026-10-16)

- **Official skill repos have no such skill.** Tree listings by `gh api`:
  `anthropics/skills`, `obra/superpowers`, `vercel-labs/skills`, and
  `vercel-labs/agent-skills` have no update, sync, or upgrade skill for
  local checkouts.
- **skills.sh search.** Queries "update tooling", "update git repos",
  "pull all repos", "dotfiles apply", and "update dev tools" return
  language or vendor skills. The two close matches:
  - `paulbaranowski/wild-horses` `update-git-repos`: a Python CLI that
    fast-forwards a configured repo list and skips or stashes dirty repos.
    It covers step 1 only. It counts only tracked-file changes as dirty, so
    untracked files do not stop a pull. It can `stash`, which the dotfiles
    skill forbids. It has 14 GitHub stars and almost no installs on skills.sh.
  - `bmad-labs/skills` `multi-repo-git-ops`: branch and commit work across
    git submodules. It does not refresh local checkouts.
- **GitHub code search.** `gh search code` for `update-tooling` in
  `SKILL.md` files returns no match outside dotfiles.
- **dotfiles already checked the tool side today.** dotfiles
  `docs/plans/replace-relocate-update-tooling-orchestration.md` (2026-10-16)
  rejects topgrade `git_repos`, `chezmoi update` (`git pull --autostash
  --rebase`), myrepos, gita, and mu-repo for step 1. None of them skips and
  reports a dirty or diverged checkout.
- **Steps 2 to 4 are host-owned.** They drive the applied agentbrew build,
  the chezmoi source path, and dotfiles LaunchAgents. dotfiles owns those
  (dotfiles AGENTS.md ownership boundary). The catalog entry adds no skill
  text, so it does not duplicate the skill.

## Recommendation

**Option A: keep the dotfiles pointer.** No upstream skill covers the
host-specific steps. The one generic candidate covers step 1 only, has very
low adoption, and allows `stash`, which breaks the "never touch unowned
work" rule.

Do not contribute step 1 upstream now. `wild-horses` `update-git-repos`
already exists for that job. If it gains a "skip on untracked files" mode
and wider adoption, dotfiles can wrap it for step 1. That is a dotfiles
decision, not an agentbrew one.

## Follow-up

None in agentbrew. Re-check when one of these happens:

- an official skill repo ships a local-checkout refresh skill; or
- dotfiles moves step 1 to an upstream tool (the pointer then still holds,
  because steps 2 to 4 stay in dotfiles).
