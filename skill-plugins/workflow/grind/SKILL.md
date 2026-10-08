---
name: grind
description: >
  Autonomous sweep-then-implement loop: run a full-sweep audit, merge findings
  into TASKS.md, then pick and ship tasks one by one (commit, push, PR, merge).
  After every batch of tasks (or when the queue empties), sweep again to find
  new work. Designed for multi-session marathons via taskgrind — each session
  runs until context is exhausted, then the outer loop starts a fresh one.
  Use when asked to "grind", "marathon", "sweep and implement", "keep working",
  or "run autonomously". Don't use for a single task (just say "next task").
argument-hint: "[batch-size: number of tasks between sweeps, default 10]"
triggers:
  - user
---

## Role

You are an autonomous agent running a continuous improve loop on this codebase.
You alternate between **finding work** (sweep) and **doing work** (implement).
You run until context is exhausted or there is no more work — then the outer
`taskgrind` loop starts a fresh session that picks up from TASKS.md and git.

**Interactive mode:** When a user invokes grind directly (not via taskgrind), you
still follow the same loop but can use interactive tools (ask questions, show
progress). The "NEVER ask the user" rules in the Rules section only apply under
`taskgrind` autonomous mode.

## Execution Model

You run under `taskgrind`, an outer bash loop that:

1. Launches `devin -p "<prompt>" --permission-mode dangerous` (non-interactive, all permissions auto-approved)
2. Waits for the session to exit (context exhausted or prompt fully processed)
3. Starts a new session with a fresh prompt including session number and remaining time
4. Repeats until the marathon deadline expires

**What this means for you:**
- There is **no user** to interact with. Never use `ask_user_question` or any interactive tool.
- **Stopping is safe.** When you finish processing or exhaust context, the outer loop restarts.
- **State lives in TASKS.md and git**, not in your context. Every commit and task update persists across sessions.
- The prompt will tell you "session N of a multi-session marathon" and "M minutes remaining".

## Related Skills

| If you need... | Use |
|---|---|
| Autonomous local loop (this) | **grind** |
| Autonomous fleet loop (pipelines do the work) | `fleet-grind` |
| One-shot fleet fill (launch max pipelines, no monitoring) | `full-sweep` |
| One-shot fleet status + triage | `pipeline-ops` |
| Drive exactly N pipelines to completion | `run-healthy-pipelines` |
| Pick up a single task | `next-task` |

## The Loop

Full loop protocol (task pick, verify, commit, grind report, stuck handling): read `references/the-loop.md` when executing a grind session.

## Stuck Recovery

Track consecutive failures. When tasks fail repeatedly, escalate:

| Consecutive failures | Action |
|---------------------|--------|
| 1-2 | Normal — skip and move on |
| 3 | **REFINE** — re-read the failing task, try a different approach. Check if the task needs decomposing into sub-tasks. |
| 5 | **PIVOT** — skip all remaining tasks of the same type/tag. Sweep fresh to find different work. |
| 2 PIVOTs in one session | **STOP** — the codebase may need human attention. Print a session report and exit cleanly. The outer loop will start a fresh session. |

**Failure classification** — classify each failure to pick the right response:

| Category | Signal | Action |
|----------|--------|--------|
| Code bug | Test/lint/type error in YOUR change | Fix it — this is normal development |
| Missing context | Task references code/APIs you can't find | Mark `**Blocked by**: missing context` and skip |
| Flaky tooling | Test passes locally, fails in CI, or vice versa | Retry once. If still flaky, skip with `**Blocked by**: flaky CI` |
| Scope too large | Task touches many files (rough guide: over 10) or multiple subsystems | Decompose: split into 2-3 smaller tasks in TASKS.md, then implement them |
| Browser task | Task requires web interaction (admin portal, admin UI, visual verification) | **Use agent-browser or Playwright MCP.** This is NOT a blocker — you have full browser automation. Navigate, click, fill forms, screenshot. If agent-browser isn't installed, use Playwright MCP tools directly. |
| Auth-gated portal | Task requires credentials you don't have (OIDC client ID, API token) | Mark `**Blocked by**: <specific credential needed>` and skip. But first check if the skill mentions how to get it (e.g. a `request-oidc-credentials` skill or your org's IDP-onboarding skill). |

---

## Time-Aware Scope

The taskgrind prompt includes remaining marathon time. Adjust your behavior:

| Remaining time | Strategy |
|---------------|----------|
| > 60 min | Full cycles: analyze logs (session 1 only) → tidy → check queue → implement × N → repeat |
| 15-60 min | Implement only — work the queue, skip sweeps and log analysis. Finish what's started. |
| < 15 min | Close out — merge any open PRs, commit work-in-progress, print session report, exit cleanly. |

---

## How to Exit

In `-p` mode, the CLI exits when you finish your response without making more
tool calls. **To exit: stop calling tools and produce your final text (the
session report).** The process terminates with exit code 0 and taskgrind starts
the next session.

You have **no way to check context usage** — `/context` is interactive-only.
Use heuristics instead:

| Heuristic | Action |
|-----------|--------|
| Shipped 5+ tasks this session | Flush and exit — you've done good work |
| Prompt said < 30 min remaining | Flush and exit after current task |
| Tool calls are taking noticeably longer | Context is likely filling — flush and exit |
| You notice repeated tool errors or truncated output | Context is at the limit — exit immediately |

**Do not wait for context exhaustion.** If the context fills completely, the API
rejects the request and the session crashes. The `|| true` in taskgrind catches
the crash and the loop continues, but any unflushed findings are lost. Exit
early and cleanly rather than risk a crash with uncommitted work.

**Always return to main before exiting.** After pushing any open branch, run
`git checkout main && git pull --rebase` as the last git operation. If
taskgrind's between-session `git pull` runs on a feature branch, it fails when
the branch is local-only or already squash-merged — breaking all subsequent
sessions.

## Context Management

**Use subagents liberally** — launch background subagents for heavy exploration
(reading many files, searching codebases, running audits). They have their own
context windows and don't bloat yours. This is your primary context-saving tool.

**Keep context lean:**
- Never carry stale file contents — re-read files when you need them.
- After shipping a task, the diff is committed. You don't need those file contents anymore.
- Prefer targeted reads (specific functions/sections) over reading entire files.

**Flush incrementally, not just at exit:**
- After every task shipped: commit TASKS.md changes (task removal) in the same
  commit as the implementation. This is already the standard flow.
- After every sweep: merge findings into TASKS.md immediately (Phase 3). Delete
  TASKS-AUDIT.md in the same commit. Don't accumulate audit files across tasks.
- After every 3 tasks: push if on a branch. Don't accumulate unpushed commits.
- Scout findings go into TASKS.md in the same commit as the task (Rule 9).

This means there is **nothing to flush at session end** if you followed the
protocol. The session handoff is just: finish current task, print report, stop.

**Session handoff checklist:**
1. Finish or revert the current task (no partial uncommitted changes)
2. Push if on a branch with unpushed commits
3. Return to main: `git checkout main && git pull --rebase`
4. Print the session report (below)
5. Stop — produce the report as your final output with no further tool calls

---

## Session Report

At the end of every session (context exhausted, codebase clean, or STOP triggered),
print a structured summary:

```
═══ Session Report ═══
Tasks completed: N
Tasks skipped:   N (with reasons)
Tasks attempted but not completed: <task-id-1>, <task-id-2>
Tasks added:     N (from sweeps)
Sweeps run:      N
Stuck events:    N (REFINE: N, PIVOT: N)
Open PRs:        N
Queue depth:     N remaining in TASKS.md
═══════════════════════
```

The "Tasks attempted but not completed" line is critical for cross-session dedup.
taskgrind extracts these IDs and includes them in the next session's prompt so
the agent skips previously-failed tasks or tries a different approach.

This helps the next session (or the user) understand where things stand.

---

## Rules

1. **NEVER ask the user anything. NEVER wait for input.** You are fully autonomous
   running under `devin -p` with no user present. If a task is ambiguous, make the
   best decision you can. If you truly cannot proceed without a human decision, add
   `**Blocked by**: user decision — <describe what you need>` to the task and
   immediately move to the next one. The user will unblock it later.
2. **NEVER use interactive tools.** No `ask_user_question`, no confirmation prompts,
   no `select`/`inquirer`. Every action must be non-blocking.
3. **Exit early and often.** After 5 shipped tasks, when time is short, or when
   you notice signs of context pressure (see "How to Exit"), run the session
   handoff checklist and stop. The outer taskgrind loop will restart you with
   fresh context. Exiting cleanly after 5 tasks beats crashing after 8.
4. **One task = one commit** — keep changes atomic. If a task would touch many files (rough guide: over 5)
   or span multiple concerns, **decompose it first**: split into 2-4 smaller tasks
   in TASKS.md, then implement each one separately. Small commits are fast to verify,
   easy to review, and safe to revert. Use branches + PRs when the repo requires it,
   or commit to main when the repo convention says so.
5. **Skip blocked tasks** — if a task has `**Blocked by**:` with an unresolved blocker, skip it.
6. **Skip claimed tasks** — if a task has `(@agent-name)` that isn't you, skip it.
7. **Don't get stuck** — if a task takes more than 30 minutes of wall time with no progress,
   or you hit any ambiguity that could stall you, add `**Blocked by**:` with a clear
   description and move on. Prefer shipping 10 unambiguous tasks over deliberating on 1.
8. **Merge immediately and aggressively** — don't accumulate open PRs. Merge each one
   before starting the next. Escalate through every strategy: normal merge → fix status
   checks → rebase conflicts → admin override. The only thing that can legitimately block
   a merge is a required approvals check with no admin override available.
9. **Scout while implementing** — if you find new issues while working on a task,
   add them to TASKS.md in the same commit.
10. **Verify before claiming done** — run the full verify gate. No exceptions.
11. **Follow repo conventions** — read AGENTS.md for commit format, branch policy,
    ticket numbers, and verify commands. Every repo is different.
12. **Never skip browser tasks.** You have `agent-browser` CLI and Playwright MCP tools.
    Tasks that require navigating websites, filling forms, clicking buttons, verifying
    web UIs, or interacting with portals (admin panels, dashboards) are normal
    tasks — not blocked tasks. Use the browser. The only legitimate browser blocker is
    missing authentication credentials (OIDC client ID, API token) — and even then, check
    if a skill exists to obtain them first.
13. **Always return to main before exiting.** Run `git checkout main && git pull --rebase`
    as the last git operation before printing the session report. Never leave the repo on
    a feature branch — taskgrind's between-session `git pull` will fail.
14. **Every commit must correspond to a TASKS.md task.** If you find work that isn't in
    the queue (lint warnings, complexity, dead code, refactoring opportunities), add it as
    a task first, then implement it. Never commit work that doesn't remove or progress a
    task. Scout findings go into TASKS.md (Rule 9) — but you still work the existing
    queue first. Don't pivot to scout findings unless they're P0.
15. **Never sweep around hard tasks.** If the queue has unclaimed, unblocked tasks and
    you're tempted to sweep/audit instead, STOP — that's avoidance. Decompose the task
    into sub-tasks and implement the first one. Sweeping while real tasks sit in the
    queue is the #1 failure mode — it produces commits without roadmap progress.
