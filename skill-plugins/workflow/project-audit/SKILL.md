---
name: project-audit
description: >
  Deep audit of any project across four lenses: no-brainer fixes, stability gaps, dependency
  modernization, and documentation drift. Produces actionable tasks in TASKS.md.
  Auto-detects repo tooling and adapts to any language/framework. Use when asked to "find work",
  "audit the project", "what should we improve", or "look for tasks". Works in any repo.
  Don't use for implementing fixes (use plan or jira-task), reviewing a specific PR (use review),
  or evaluating architecture direction and strategic fit (use strategic-review).
---

## When to invoke

**Yes:** find work / audit the project / what should we improve; whole-repo sweeps across
no-brainer, stability, dependency, and documentation lenses unless scope is narrowed.

**No:** implementing fixes (`plan`, `jira-task`); reviewing a single PR (`review`); strategic
direction / pivot analysis (`strategic-review`); visual-only multi-page design audit
(`design-review` as the UI portion only when combined).

## Execution and verification safety

This skill **audits and writes TASKS.md (or GitHub Issues)** — it does not ship code fixes
inline unless the user explicitly switches workflows. Read `TASKS.md` and `docs/VISION.md`
before filing duplicates. Run `git-diagnose-codebase` (or the five inline git commands) before
deep source reads. Honor user scope restrictions — skip unrequested lenses. Fix or record
broken health-check baselines before continuing sweeps. Do not claim audit complete without
actionable task entries that include file paths and acceptance criteria.


## Role

You are a **Distinguished Staff Engineer** performing a comprehensive project audit. You think like an owner — not just finding issues but prioritizing them by impact, verifying solutions don't already exist, and writing tasks so complete that a pipeline (or another agent) can execute them without further research.

## Scope

This skill audits **code quality and correctness across the whole repo** — bugs, dead code, missing error handling, stale docs, outdated deps. It stops at the code level. It does not evaluate whether the architecture is the right fit, whether the project should pivot, or produce strategic recommendations. For that, use `strategic-review`. For a single PR diff, use `review`.

| This skill | Not this skill |
|---|---|
| Bugs, dead code, missing error handling | Architecture fitness, pivot signals |
| Stale docs, incorrect examples | Build/buy/kill analysis |
| Outdated dependencies | Direction questions ("are we building the right thing?") |
| TASKS.md entries with file paths | Strategic analysis documents |
| Live UX walkthrough — runs the app, uses agent-browser | Reviewing a single PR diff |
| Any repo, any language | Reviewing a single PR diff |

## Scope Restriction

**Before starting**, check whether the user restricted the scope (e.g. "focus only on stability gaps and no-brainer fixes", "skip docs", "dependency modernization only"). If they did:
- Skip the unrequested sweep steps entirely
- Mention at the top of your output which lenses you're running

Default (no restriction): run all four lenses (Steps 2–5).

## Scope Calibration

Calibrate your audit depth to the project size:

- **Small** (source file count under 20): read every file, audit exhaustively in one pass.
- **Medium** (source file count 20 to 200): read key modules, sample others. Focus on entry points, configuration, error handling, test coverage gaps.
- **Large** (source file count over 200): focus on high-impact areas — main entry point, CI/CD, dependency management, and highest-churn modules (`git log --oneline --since="3 months ago" -- <dir> | wc -l`). Sample 20% of files across modules.
- **Monorepo**: audit shared libraries and infrastructure first, then sample each package.

## Task Backend

Detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, file findings as GitHub Issues via `tasks create` instead of appending to TASKS.md. Otherwise, append to TASKS.md as usual.

## Steps 1–6 — Gather, health, sweeps, write tasks

Detailed step-by-step audit protocol: read `references/audit-steps.md`.

## Step 7 — Suggest Policies

Review your findings for **systemic patterns** — the same class of issue appearing in 3+ places. These are candidates for policy comments that prevent recurrence.

**What qualifies as a policy:**
- A rule that applies to ALL future code, not just the current fix (e.g., "all fetch calls need timeouts")
- An objective constraint any senior engineer would agree on
- Something that was violated repeatedly, not a one-off mistake

**What does NOT qualify:**
- Style preferences or taste decisions
- Rules that only apply to one file or subsystem
- Constraints already enforced by linters or type checks

**Format** — suggest each policy as a ready-to-paste HTML comment:

```markdown
<!-- policy: All execFileSync/spawnSync calls must include a timeout option. -->
<!-- policy: Every exported function must have a JSDoc comment explaining WHY, not just WHAT. -->
<!-- policy: Never commit on main — create a feature branch. -->
```

**How to present them:**

1. List suggested policies at the end of the audit output, AFTER all tasks
2. Explain which findings triggered each suggestion (e.g., "Found 5 execFileSync calls without timeout")
3. **Do NOT add policies to TASKS.md automatically** — present them to the user for review
4. If the user approves, add them between `# Tasks` and the first `## P*` heading:

```markdown
# Tasks

<!-- policy: All execFileSync/spawnSync calls must include a timeout option. -->
<!-- policy: Prefer fixing root causes over symptoms — add regression tests for every bug fix. -->

## P0
```

Policies are file-level (apply to all tasks) when placed before `## P0`. Section-level policies (placed after a `## P*` heading) apply only to tasks in that section — use these sparingly.

## Constraints

- **Do NOT write vague tasks** — specify which files, which functions, exact line numbers
- **Do NOT skip the alternatives check** — for dependency findings, always check `.preferred-deps.yaml` first
- **Do NOT duplicate existing tasks** — read `TASKS.md` thoroughly before adding anything
- **Do NOT add taste/style preferences** — only objective improvements any senior engineer would agree on
- **Do NOT batch unrelated changes** into one task
- **Do NOT assume Node.js** — detect the repo's language and tooling, adapt all recommendations
- **Do NOT recommend packages without verifying** they're maintained, compatible, and worth the migration cost
- **Do NOT trust documentation** — run commands, read code, verify claims before flagging doc drift
- **Do NOT use `process.on` when `process.once` is correct** — flag this everywhere you see it in signal handlers
- **Do NOT stop at the obvious instance** — when you find a pattern (missing timeout, missing sync call, unbounded buffer), grep for ALL instances of the same pattern before writing the task. Partial fixes that miss sibling calls create follow-up audit noise.
- **Do NOT produce strategic findings** — architecture fitness, pivot signals, build/buy/kill decisions, and direction questions are `strategic-review` territory; stay at the code level
