# Plan: absorb taskgrind, then archive it

Date: 2026-11-18. Owner decision: the outer loop moves to Claude Code's
native `/loop` and `/goal`; `fyodoriv/taskgrind` is archived and its tap
formula removed.

## Why

taskgrind is a 5,700-line bash runner. It starts fresh agent sessions until
a deadline. Native `/loop` and `/goal` now keep one session going across
context compaction, so the runner is redundant. Field data: none. The proof
section in its README says "not measured yet" for every row, and no usage
log exists on the owner's Mac.

## Map

Each taskgrind feature or open task gets one row: **absorb** (and where),
**covered** (something else already does it), or **drop** (with a reason).

### Features

| Feature | Verdict | Home or reason |
|---|---|---|
| Fresh sessions until a deadline | covered | `/goal <end state + time>`, `/loop /grind`, or a scheduled `claude -p` (grind skill, "How to run it") |
| Preflight: no rebase/merge/detached HEAD, dirty-tree count | absorb | grind `references/run-guards.md` 1 |
| Caffeinate during a long run | absorb | grind `references/run-guards.md` 1 (`caffeinate -i`) |
| Git sync between sessions, TASKS.md-only conflict auto-resolve | absorb | grind `references/run-guards.md` 2 (keep both sides' blocks, not "keep local") |
| Per-task 3-attempt cap | absorb | grind `references/run-guards.md` 3 (`**Blocked by**: attempted 3 times`) |
| All-tasks-blocked wait, then exit | absorb | grind `references/run-guards.md` 4 |
| Stall / diminishing-returns exit | absorb | grind `references/run-guards.md` 5 (two empty passes) |
| Empty-queue sweep | absorb | grind `references/run-guards.md` 6 (already in the loop's sweep phase) |
| Network pause and retry | absorb | grind `references/run-guards.md` 7 |
| Session report + attempted-task IDs | covered | grind skill, Session Report (already there) |
| Past-log analysis at session start | absorb | grind `references/the-loop.md` Phase 0a now reads git log, stuck-cap notes, open PRs |
| Multi-backend (Claude/Codex), model aliases | drop | Each CLI picks its own model; agentbrew already syncs skills to both |
| Live `.taskgrind-prompt` / `.taskgrind-model` files | drop | A running `/loop` takes a new message directly |
| Slot locking for several grinds per repo | covered | Claude Code worktrees; tasks.md git-native claims |
| `--from-prompt` natural-language config | covered | `/goal` takes natural language |
| `--resume` after reboot | covered | State is in git and TASKS.md; `claude --resume` |
| Supervisor repair mode | drop | Never used in the field; `watch-issues` fixes red PRs |
| Bosun pipeline checks and grind-session lifecycle | drop | Org-only orchestrator; does not belong in public repos |
| Self-copy to `$TMPDIR` | drop | Only needed by a long-running bash script |
| Productive-timeout auto-increase, fast-fail backoff, min-session | drop | Runner internals with no native-loop equivalent needed |
| Usage log, proof page, opt-in telemetry | drop | Never recorded data; agentbrew telemetry covers tool usage |
| `grind-report` skill (reads `/tmp/taskgrind-*.log`) | drop | Its only input was taskgrind logs; skill removed |
| `docs/defaults-rationale.md` | drop | Rationale for runner timeouts that no longer exist |
| `docs/research/skillclaw-export.md` | drop | Spike about exporting taskgrind logs; past its re-check date |
| Repo-local skill mirrors under `.claude/` | covered | Sources already live in agentbrew |

### Open tasks in taskgrind TASKS.md (42)

All 42 tasks change the bash runner or its tests. The runner is retired, so
they are dropped. The few with an idea that outlives the runner:

| Task | Verdict | Home |
|---|---|---|
| `detect-queue-fully-blocked-and-bail` | absorb | Run guards 4 |
| `detect-mid-session-agent-stall`, `auto-bail-on-consecutive-backend-failures`, `sweep-watchdog-bail-on-no-progress` | absorb | Run guards 5 |
| `final-sync-warn-on-stranded-feature-branch`, `health-check-detect-stranded-commits` | covered | grind handoff checklist (return to the default branch, push first) |
| `detect-and-clean-content-merged-branches` | covered | `ship-it` branch cleanup step |
| `agent-worktree-isolation`, `git-sync-handle-worktree-collision`, `slot-non-zero-git-sync-drift` | covered | Claude Code worktrees |
| Every `bosun-*` and `*-bosun-*` task | drop | Org-only orchestrator |
| `supervisor-*` | drop | Supervisor mode retired |
| All test-speed, help-text, DVB prefix, watchdog, and status-file tasks | drop | Runner internals |

### tasks.md

No change. tasks.md mentions taskgrind only in a dated measurement note
(`docs/plans/ship-review-tasks-and-lint-bare-or-duplicate-task-fields.md`).
A TASKS.md merge driver was considered and dropped: taskgrind's
"keep local" resolution loses remote edits, and git-native claims already
keep agents from editing the same block.

### dotfiles

`tooling-checkup` lists taskgrind as a tooling repo and owns `com.taskgrind.*`
LaunchAgents. Those entries are removed. `config/public-push-remotes.txt`
loses the taskgrind remote, since an archived repo takes no pushes.

## Done when

1. This map is merged.
2. No live skill, catalog entry, or script in agentbrew, dotfiles, or
   tasks.md runs taskgrind.
3. `gh repo view fyodoriv/taskgrind --json isArchived` returns `true`, its
   README points here, and the tap formula is gone.
