# Fix PRs, task PRs, and carrying unmerged fixes

Read this before step 5 (a fix PR), or when the signed-in account owns the
repo and a finding becomes a task. It covers the whole loop after a yes:
choose fix or task, prove the fix, check privacy, open the PR, keep the
machine running on fixes that are not merged yet, and look after open PRs.

## 1. Fix or task?

- **Fix PR now** when the finding blocks installing or using the tool,
  deletes or overwrites the person's data, weakens safety (permissions,
  secrets, privacy), or is a small bug you can prove with a test.
- **Task PR** for everything else: ideas, speedups, doc gaps, larger
  redesigns. Add it to the repo's task queue in its own format (copy a nearby
  entry with all its fields). First search the queue for the topic and extend
  an existing task instead of adding a duplicate.
- Several small findings for one repo go in one task PR.

## 2. Make the fix

1. Branch from the default branch in a worktree:
   `git worktree add -b fix/<short-name> <wt-dir> origin/<default>`.
2. Fix the root cause. Add a regression test that fails before the fix and
   passes after it. Prove it: revert the fix (or commit it aside), run the
   test, see it fail, restore.
3. Run the repo's own gate (its `AGENTS.md` `## Delivery`). A failure that
   also fails on the default branch is pre-existing: note it in the PR, do not
   fix it in the same PR.
4. Update the docs the change touches. The PR body needs a `## Docs` section.
5. Commit with a conventional header. The body says what a user hits and why
   the fix is right.

## 3. Privacy check before every push

Scan the added lines of the diff, the PR body, and the commit authors and
messages for the person's name, emails, home path, business and account
names, and secrets. Keep the patterns in a private file outside every repo
(the person's leak-gate patterns, or `agentbrew report`'s scrubber); never
commit them. Fix every hit. Never use a placeholder that hints at the real
value. Describe the machine generically ("a Mac used mainly for non-coding
agent work"). Read the diff yourself as well; a pattern list misses new names.

## 4. Open the PR

- Without push access: `agentbrew contribute` forks the repo and opens the
  PR. By hand: `gh repo fork <owner/name> --remote --remote-name fork`, push
  the branch to `fork`, then
  `gh pr create --repo <owner/name> --base <default> --head <you>:<branch>`.
- A standing approval (the person said "open PRs to this repo without asking")
  covers pushing to their fork and opening the PR once the privacy check
  passes. It never covers merging or pushing to the upstream repo.
- Remove the worktree after the push.

## 5. Keep the machine on unmerged fixes

When the person runs the tool from a local clone, a fix helps them only once
it is built there. Keep one local integration branch (for example
`local/this-machine`): the default branch plus every open fix branch.

```bash
git switch local/this-machine && git merge --no-edit fix/<name>   # then build or apply
```

After upstream merges, rebuild it from scratch:
`git fetch origin && git switch local/this-machine && git reset --hard origin/<default>`,
then merge each still-open fix branch again. When no fix is open, switch back
to the default branch. Ask before the `reset --hard` if the branch holds
anything that is not on a fix branch.

Then re-check the person's own settings (a verify script, or the tool's
doctor). A tool update that undoes one of their choices is a new fix PR.

## 6. Look after open PRs

On each check-up: list the person's open PRs on the repo, fix red checks on
the branch, answer or resolve every review comment, and merge the default
branch into the branch when it conflicts. Report merged PRs and drop their
branches from the integration branch.

## Gotchas

- Commit before you switch branches. Uncommitted edits travel with you and
  end up in the next `git add -A`.
- A squash-merged branch looks unmerged to `git branch -d`. Check the PR state
  (`gh pr view <n> --json state`) before you ask to delete it.
- An agent's safety check may refuse `gh pr create` or branch deletes. Push
  the branch, save the PR body, keep working, and ask once at the end with the
  exact commands.
- An installer that appends to a dotfile which is a symlink into a repo edits
  that repo. Move the line to a local, untracked file and restore the repo file.
