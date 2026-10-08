---
name: sweep
description: >
  Parallel-safe codebase sweep that finds no-brainer improvements, stages them in
  TASKS-AUDIT.md during the sweep, then drains every finding into TASKS.md P3 in
  one atomic commit at session end. TASKS-AUDIT.md is a per-session staging buffer,
  not a queue. Run this in one session while another session implements tasks.
  Use when asked to "sweep", "find work", "audit", "full sweep", or "what needs
  fixing". Don't use for implementing fixes (just pick tasks from TASKS.md) or
  reviewing a specific PR (use review).
argument-hint: "[focus: stability | testing | docs | deps | dx | perf | vision | all]"
triggers:
  - user
  - model
---

## Role

You are a **read-only auditor** running in parallel with another agent that implements tasks.
You NEVER modify source files. You stage findings in `TASKS-AUDIT.md` during the sweep,
then drain every finding into `TASKS.md` P3 at session end (Step 6).

## Parallel Safety Rules

1. **Never modify source files** — you are read-only. No code changes, no formatting fixes.
2. **TASKS-AUDIT.md is a per-session staging buffer, not a queue.** Sessions never inherit a
   pre-filled audit file. Step 6 drains every finding into `TASKS.md` P3 and resets the buffer.
3. **TASKS.md appends are safe.** Atomic per-section appends to `TASKS.md` P3 don't conflict
   with completed-task removals from the implementing agent because they touch different
   lines. (Old rule was "never touch TASKS.md" + park-on-`audit/*`-branch — that flow
   stockpiled findings on dead branches that never reached `TASKS.md`. Fixed 2026-04-27.)
4. **Use a dedicated git branch** — `chore/sweep-drain-YYYY-MM-DD` (not `audit/*` or
   `sweep/*` which never merged). PR'd to main directly for fast merge.
5. **Don't run `git add .`** — only stage `TASKS.md` and `TASKS-AUDIT.md`.

## Process

Full sweep workflow (inventory, focus modes, task filing): read `references/process.md` before running a sweep.

## P1
...

## P2
...

## P3
...
```

Each task uses the standard format:
```markdown
- [ ] Outcome-shaped task description
  **ID**: kebab-case-id
  **Tags**: tag1, tag2
  **Details**: What's wrong, where, why it matters.
  **Files**: affected files
  **Acceptance**: what "done" looks like (mechanically verifiable)
```

### Step 6: Drain TASKS-AUDIT.md → TASKS.md and commit

**Drain is mandatory. Every sweep ends with `TASKS-AUDIT.md` reset to its empty
header.** No exceptions. The previous "park on `audit/*` / `sweep/*` branch"
flow left findings on dead branches; they never reached `TASKS.md` and the
queue rotted.

```bash
# 1. Append every TASKS-AUDIT.md task block to TASKS.md under a sub-heading
#    in P3. Use the tasks-md spec — bullets with the exact same metadata fields.
DATE_TAG="$(date +%Y-%m-%d)"
SWEEP_HDR="### From sweep audit ($DATE_TAG)"

# 2. Reset TASKS-AUDIT.md to its empty-header form so the next session starts clean.
cat > TASKS-AUDIT.md <<'EOF'
# Tasks

Per-session staging buffer for `sweep` audits. Step 6 drains every finding into
`TASKS.md` P3 at session end and resets this file. If you see unclaimed tasks
here outside an in-flight sweep, the previous session's drain failed — file an
issue.

## P0

## P1

## P2

## P3
EOF

# 3. Commit BOTH files in one commit so the drain is atomic.
git add TASKS.md TASKS-AUDIT.md
git commit -m "chore(sweep): drain N findings → TASKS.md P3 + reset audit buffer TICKET-ID"
git push -u origin "chore/sweep-drain-$DATE_TAG"

# 4. PR for fast merge to main. NOT a draft.
gh pr create --title "chore(sweep): drain N findings → TASKS.md P3 TICKET-ID" \
  --body "Auto-drain per sweep skill Step 6. Findings land in P3; future sessions elevate."
```

After merge, `TASKS-AUDIT.md` is empty again and every finding is in `TASKS.md`
P3. The implementing agent picks them up like any other task. **Don't** open a
`audit/*` or `sweep/*` PR — those parked findings on dead branches and never
reached the queue.

## Focus modes

The user can pass a focus area as $1:

| Focus | Tiers to run | Best for |
|-------|-------------|----------|
| `stability` | 1, 2 | Hardening before release |
| `testing` | 1, 3 | Improving test coverage |
| `docs` | 4, 8 | README/docs accuracy audit |
| `deps` | 6 | Dependency hygiene |
| `dx` | 5, 7 | Developer experience polish |
| `perf` | 1, 5, 6 | Build/runtime performance |
| `vision` | 4, 7, 8 | Strategic alignment check |
| `all` (default) | 1-8 | Full sweep |

## Progressive depth

When running as part of a grind loop (repeated sweeps), go deeper on each pass:

- **Pass 1**: Broad scan across all tiers. Find the obvious stuff.
- **Pass 2+**: Focus on tiers that produced the most findings last time. Go deeper:
  read individual functions, trace call paths, check edge cases that pass 1 missed.
- **Diminishing returns**: If a sweep produces < 3 new findings, the codebase is clean.
  Report "sweep clean" and let the grind loop stop or switch to a different repo.

## What makes a good audit task

- **Outcome-shaped**: "Users see actionable error messages" not "Add chalk.dim hint to line 321"
- **Verifiable**: Include acceptance criteria that can be checked mechanically
- **Deduplicated**: Never repeat what's already in TASKS.md
- **Sized right**: One task = one PR. Not too granular (don't create 18 tasks for 18 icon fixes — that's one task)
- **Has context**: Include file paths, line numbers, and the current vs desired behavior
