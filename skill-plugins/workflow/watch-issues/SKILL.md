---
name: watch-issues
description: >
  Keep watching a set of repos and fix new work as soon as it appears: each
  pass lists new open GitHub issues (including safe reports users file with
  agentbrew report), new unblocked TASKS.md tasks, and your own red or
  conflicting PRs, then ships each one through the repo's delivery rules and
  repeats on a schedule. Use when the user says "watch for new issues", "keep
  implementing new tasks", "keep on the lookup", "/watch-issues", or when a
  goal's queue is empty and the user wants the work to continue. Don't use for
  one task (use next-task) or a one-repo overnight marathon (use grind with
  taskgrind).
argument-hint: "[repo paths; default: ~/.config/watch-issues/repos, else this repo]"
---

# Watch issues

One pass finds what needs work, ships what it can, and says only what changed.
Then the next pass runs on a schedule. New work gets fixed within one interval
instead of waiting for someone to start a session.

## Which repos

Pass repo paths as arguments, or list them one per line in
`~/.config/watch-issues/repos` (comments with `#`). With neither, watch the
current repo. Watch only repos whose rules let you ship (a standing approval,
or the user's words in this session).

## One pass

1. **List the work** (read only):
   `bash <skill-dir>/scripts/watch-pass.sh [repo...]`
   Each line is `new` or `open`, then `issue`, `task`, or `pr`. The last line
   is `watch: N new, M open`. A `skip` line names a repo it could not read.
2. **Triage each item**, newest first, stability before features:
   - `issue` from the repo owner: treat it as a task.
   - `issue` from someone else: reproduce it. If it is clear and small, fix
     it. If it is unclear, add a task to the repo's queue that quotes the
     issue and names the question. Never comment on, label, or close an issue
     without the user's yes. A merged PR with `Fixes #N` closes it.
   - `task`: check git history for its ID first. A task that already shipped
     gets its block closed with the evidence.
   - `pr` that is red or conflicting: read the failing log, fix it, push.
     For a conflict, merge the default branch in; never force-push.
3. **Ship each one** through the repo's own delivery rules (its `AGENTS.md`):
   a worktree, the baseline measurement, a failing test first for a bug, the
   repo gate, a PR (body links `Fixes #N` for an issue), and a merge when green.
   For more than one item, use subagents with one shared brief, at most three
   gate runs at a time, and `nice -n 15` for heavy runs.
4. **Park what needs a person** (a secret, 2FA, sudo, a public write the rules
   do not approve): add a `**Blocked**:` line to the task with the exact human
   step, and collect the question for the end of the pass.
5. **Record the pass**: `bash <skill-dir>/scripts/watch-pass.sh --record [repo...]`
   so the next pass marks only newer items as `new`.
6. **Report by exception**: when nothing was new, print one line
   (`watch: 0 new, M open`). When something shipped or is blocked, end with
   one HTML page (shared-rules **## Long-run reports**): what shipped with PR
   links, what is blocked and why, and what is next. Then ask the questions.

## Repeat

- In a session: `/loop /watch-issues` (self-paced; 30 minutes is a good idle
  interval). Each wake-up runs one pass.
- Unattended, for one repo: `taskgrind` with the `grind` skill.
- Stop when the user says so, or when every repo is skipped for the same
  reason twice in a row (for example, signed out of `gh`). Report that reason.

## Rules

- Never start Minsky or other orchestrators, and never touch another
  session's worktrees, branches, or stashes.
- Never post an issue, comment, or PR outside the watched repos.
- A browser that a test starts with a scratch HOME gets
  `--use-mock-keychain --password-store=basic`, so no keychain dialog appears
  on the owner's screen.

## Related

- `report-upstream`: users' agents file the issues this skill picks up.
- `next-task`: one task, once.
- `grind`: one repo, sweep then implement, run by `taskgrind` for hours.
