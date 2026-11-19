---
name: karpathy-disciplines
description: Prime a coding session with four engineering disciplines before touching code - think before coding, simplicity first, surgical changes, and goal-driven execution that loops until a runnable check passes. Use at the start of any implementation or bugfix task, or when a diff grows beyond the request. Don't use for pure research, planning-only work, or one-line typo fixes.
---

# Karpathy disciplines

These rules govern HOW you work. The task governs WHAT you work on.
Source: Karpathy (2024), LLM coding failure modes.

## The four failure modes

1. Silent assumption: you pick one reading of the task and code against it.
2. Scope creep: a working slice plus "while I was in there" cleanups.
3. Vague completion: "done" means "looks right", not "a check passed".
4. Over-engineering: abstractions for use cases nobody asked for.

Each discipline below counters one of them.

## 1. Think before coding

Do not assume. Do not hide confusion. Surface tradeoffs.

Before the first edit:

- [ ] I can restate the task and its success measure in one sentence.
- [ ] I know which files I will touch and why each is needed.
- [ ] Open questions are asked, or my assumption is written down.

When confused, stop. Name the confusion exactly. Check the repo docs. If they
do not resolve it, ask once.

## 2. Simplicity first

Write the minimum code that meets the acceptance criterion.

- No feature beyond what was asked.
- No abstraction for code used in one place.
- No configurability nobody requested.
- Reject the first idea that adds a layer. Prefer a second small function over
  generalizing; generalize at the third use.
- Read your diff cold. Ask: would a senior engineer call this overcomplicated?

## 3. Surgical changes

Touch only what the request needs. Clean up only your own mess.

- Do not improve adjacent code, comments, or formatting.
- Do not refactor working code.
- Match the existing style, even if you would do it differently.
- Report unrelated dead code. Do not fix it.
- Remove imports, variables, and functions that YOUR change made unused.

Line-trace test: every changed line must trace to the request or to an orphan
your change created. If it does not, revert it.

## 4. Goal-driven execution

Turn the task into a verifiable goal before you code. Then loop until it passes.

Write this block first (in your head or in the PR):

```
Goal:      <the task, one sentence>
Success:   <exact runnable command that proves it is done>
Pivot:     <condition that changes the approach, e.g. 3 failed approaches>
Scope:     <the files I will touch, and only those>
```

"It compiles" and "it looks right" are not success signals. The command must
inspect real output.

Loop: run the check, fix, re-run. If it still fails after three different
approaches, that is the pivot signal. Stop, report what you tried, and ask.
Never open a PR whose own check fails.

## Anti-patterns

| Pattern | Discipline | Counter |
|---|---|---|
| Open files and edit right after reading the brief | 1 | Complete the checklist first |
| Diff includes docs or config the task never named | 3 | Revert the unrelated hunks |
| "Tests pass" with no check for the stated goal | 4 | Run the goal's own command |
| New module added "for future tasks" | 2 | Write it when a task needs it |
| Touches more files than planned | 3 | Justify each extra file or revert it |

## Sources

- Karpathy, A. (2024). Thread on LLM coding failure modes.
- Basili, Caldiera, Rombach (1994). The Goal Question Metric approach.
- Ries (2011). The Lean Startup. Pivot or persevere.
