---
name: wrap-up
description: >
  Wrap up the current session: find every unfinished piece of work in this
  session and every repo it touched, deliver what can ship now, and put the
  rest in a safe draft pull request whose body lists what is pending, with a
  TASKS.md task for each pending item. Use when the user says "wrap up",
  "wrap it up", "save state", or ends a session (cloud sessions especially).
argument-hint: "[extra repo paths]"
---

# Wrap up

Leave nothing only in this session. Every piece of work ends in one of two
places: merged, or on a pushed branch with a draft PR and a task that say
exactly what is left.

## 1. Find the open work

1. List the repos this session touched: every repo you edited, committed in,
   or ran a branch-changing command in (read the transcript, not only the
   working directory), plus any paths the user passed.
2. Run `scripts/open-work.sh <repo> ...` from this skill's folder. It prints
   one line per item: `dirty`, `do-not-stage`, `worktree`, `stash`,
   `unpushed`, `branch`, `pr`, or `unknown`, with paths, branch names and
   counts only. Exit 1 means something is open. A squash-merged branch is not
   `branch` open work, even after the default branch changed the same lines,
   unless the default branch reverted it; nor is a branch whose tip is a merged PR's head (needs `gh`).
   The same holds for a `worktree` of such a branch with no uncommitted files.
3. Add what no script can see: promises in the transcript ("I'll add a test
   later", a step the user asked for that you skipped), failing checks you
   left, review comments you did not answer, and steps that need the owner
   (a real export, a consent grant, a password, a physical machine).

Each item gets one verdict:

| Verdict | When | Do |
|---|---|---|
| `deliver` | small, finished, and the repo's gate passes | the repo's delivery steps (gate, commit, push, PR, merge when green) |
| `draft` | blocked, needs the owner, needs a decision, or too much left for now | step 3 |
| `drop` | scratch output, an experiment the user rejected | delete it; say so in the report |
| `ask` | you cannot tell whether the user wants it | ask once, in the report; leave it untouched |

Never delete, reset, or force-push something you cannot classify.

## 2. Deliver what is ready

Follow the repo's own `## Delivery` section. A red gate turns the item into
`draft`: never bypass a hook, skip a test, or merge red.

## 3. Draft everything else, safely

For each repo with `draft` items:

1. **Leak check first.** Read the whole diff you are about to push
   (`git diff origin/<default>...`, plus untracked files you will add).
   Stop on any secret, token, password, private email, personal data
   (amounts, account names, payees, real names other than the owner's
   handle), or a file from an ignored private folder. Run the repo's leak
   gate when it has one (`scripts/leak-check.sh`, a pre-push privacy hook,
   or the leak check in its AGENTS.md); on a public repo, always run the
   owner's private-reference check. Never stage a path that `open-work.sh`
   lists as `do-not-stage`. Stage files by name, never `git add -A`. A draft
   PR is still published: treat it as public.
2. **Task.** Update the task in `TASKS.md` that the work belongs to, or
   create one. Use the repo's task shape (for tasks.md: an outcome title, the
   why, and the pre-registered Hypothesis, Success, Pivot, Measurement, and
   Anchor). Write the exact next step and what blocks it, and add
   `**PR**: <url>` so `next-task` matches the task to this PR. Steps that need
   the owner go in as their own task with the commands to run on their machine.
3. **Commit and push** to the session branch, or `wip/<topic>` when you have
   none (conventional header, no `--no-verify`).
4. **Draft PR.** Open it as a draft, or update the existing one for that
   branch (an unfinished ready PR goes back to draft: `gh pr ready --undo`). The body follows the repo's PR shape and always has:

   ```markdown
   ## Summary
   What this branch does and why, in 2-3 sentences.

   ## Pending
   - [ ] <item>: <next step>. Blocked by <what>. Task: `<task-id>`.

   ## Done so far
   - <what works, with the commands that prove it>

   ## Docs
   <docs changed, or "Docs: none — <reason>">
   ```

   Never paste personal data, secrets, or raw command output that holds them.

Owner-only steps with no code change go straight into `TASKS.md` on the
default branch (through a PR when the repo forbids direct pushes).

When the user's rules forbid a push (an employer's GitHub Enterprise from a
personal machine, a pipeline branch without its token, a third-party repo with
no fork), commit on the branch, keep it local, and say where it is in the task
and the report. Never post anywhere else (Slack, Jira, email) to wrap up.

## 4. Report

End with a published Artifact (shared-rules **## Long-run reports**), not a
loose HTML file. Only without the Artifact tool or with private data, send a
self-contained HTML file or give its full path. It holds:

- **Delivered:** each PR link, merged.
- **Draft:** each draft PR link and its pending task ids.
- **Needs you:** each owner step with its task id, explained in plain words:
  what it is, why only the owner can do it, and what it changes.
- **Dropped / asked:** anything you deleted, and the questions.

In chat, give the page link and one line (delivered N, drafted M), then ask
the questions from the page. Without a way to write HTML, post the same list
as one short message.

Then stop. The next session picks this up: the repo checkups and `next-task`
(its "Continue open work" step, and the hook `next-task-open-work-first`) read the same open work
(`scripts/open-work.sh`) before anything else.

## Continue open work (other skills call this)

Before starting a new task, run `scripts/open-work.sh` on the repo. When it
lists your draft PR or branch, continue it first: read the PR's `## Pending`
list and its task, then finish the first item that is not blocked. To finish
an open PR:

1. **Merge conflict:** merge the default branch into the PR branch (never
   rebase or force-push someone else's branch).
2. **Red checks:** reproduce the failure locally, fix it, push.
3. **Review comments:** fix or answer each one, then resolve it.
4. **Green, nothing pending:** mark it ready (`gh pr ready <number>`) and merge per the repo's
   delivery rules. A PR that only waits on a person stays as it is; say so.
