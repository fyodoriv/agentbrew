---
name: wrap-up
description: >
  Wrap up the current session: find every unfinished piece of work in every
  repository the session touched, deliver what is done, and park the rest as a
  safe draft pull request that lists what is pending, with its task updated or
  created. Use for "/wrap-up", "wrap up", "I'm done for today", "close out this
  session", or before a session ends with work in flight. Don't use for a
  handoff document only (use handoff) or to ship one finished change (use
  ship-it).
argument-hint: "[repo or note]"
---

# Wrap up

Leave nothing in flight: every change ends merged, or on a pushed branch with a
draft pull request and a task that says exactly what is left. Safe to run
twice; the second run finds nothing to do.

## 1. Find the touched repositories

List every repository this session touched: the start directory, every path
the session edited or committed in, and their worktrees (`git worktree list`).
Add repositories with an open pull request this session created. Name a
repository the user passed as the argument first.

For each, record without changing anything:

```bash
git status --porcelain=v1 -b          # uncommitted and untracked files
git stash list                         # parked changes
git log --oneline @{u}..HEAD           # unpushed commits (no upstream: all commits not in the default branch)
git log --oneline origin/HEAD..HEAD    # work not in the default branch
gh pr list --author @me --state open --json number,title,isDraft,headRefName,url
```

Also note work that lives outside git: files the session wrote to a scratch
folder that the repo needs (a fixture, a script), and promises made in chat
("I'll refresh X later").

## 2. Sort each piece of work

| State | Do this |
|---|---|
| Done: the repo's gate passes and nothing is pending | Deliver it now with the repo's delivery steps (`/ship-it` when the repo has it): commit, push, pull request, merge when green and allowed. |
| Not done, blocked, or too big to finish now | Park it (step 3). |
| Nothing changed | Report "clean". |
| Someone else's branch or pull request | Report only. Never push to it. |

Read the repo's own rules first (AGENTS.md or CLAUDE.md): who may merge, which
branch to use, what may never be published. A rule there beats this skill.

## 3. Park unfinished work safely

1. **Branch.** Never the default branch. Reuse the session's branch; else make
   one named for the work (`wip/<short-description>`).
2. **Leak check before every commit.** Commit only the files of this work, by
   path (no `git add -A`). Read the staged diff. Stop and unstage on: secrets,
   tokens, keys, `.env` files, personal data, private paths or hostnames, a
   user's private content, generated output, or anything the repo's rules call
   private. Run the repo's own leak or privacy gate when it has one; when it
   cannot run, say so in the pull request.
3. **Commit** with the repo's commit format, a `wip:` or matching type, and a
   body that says what is unfinished.
4. **Push** the branch (`git push -u origin <branch>`; never force).
5. **Draft pull request.** Open one, or update the open one for this branch.
   Its body has `## Summary` (what this is), `## Done` (what works now, with
   the commands that prove it), `## Pending` (a checklist: each item, why it
   is not done, the exact next step, and what unblocks it), and `## Docs`.
   Keep it free of anything step 2 would stop.
6. **Task.** Update the task for this work in the repo's task backend
   (`TASKS.md` or what the repo uses): add the pull request, what is pending,
   and `**Blocked**:` with the reason when blocked. No task yet: create one in
   the repo's format with every field its lint requires. Commit it on the same
   branch.

## 4. Report

One table for the user: repository, state (delivered, parked, clean, report
only), the pull request link, the task ID, and the one next step that is the
user's (an approval, a setting, a decision). Under it, anything you could not
check and why. Do not claim "clean" for a repository you did not inspect.

## Rules

- Never lose work: no `reset --hard`, `clean`, `checkout .`, `stash drop`, or
  force-push. A stash becomes a commit on a parked branch, never a deletion.
- Publishing outside a repository the user owns, or to a place the repo's
  rules restrict, needs the user's approval in this session.
- A wrap-up delivers or parks; it does not start new work.
