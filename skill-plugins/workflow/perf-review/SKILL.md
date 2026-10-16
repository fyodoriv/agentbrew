---
name: perf-review
description: >
  Find the slowest recurring agent steps and turn real speedups into tasks.
  Reads the agentbrew perf log (`agent-perf.mjs report`) and, for tokens and
  hours, the session-report analyzer. Use when the perf-task-review Stop hook
  asks for a "Time review", at the end of a long task, in /tooling-checkup,
  or when the user asks "what took longest" or "what can we speed up".
  Don't use for token or cost questions alone (use session-report) or for
  context size (use context-budget).
---

# Perf review

Answer two questions with data: what took the longest, and what can be
faster. Then file a task only for a speedup that is real and recurs.

## 1. Get the numbers

The perf log holds one row per tool call (step key, duration, ok). Read it
with the helper that `agentbrew sync` deploys:

```bash
H=~/.config/agentbrew/scripts/agent-perf.mjs
node $H report --session latest            # this task (current project)
node $H report --days 7                    # this project, last 7 days
node $H report --all --days 7 --json       # every project, for a checkup
```

For tokens, cache hits, cost, and active hours per project, use the
`session-report` skill's analyzer when it is installed:

```bash
node ~/.claude/skills/session-report/analyze-sessions.mjs --json --since 7d
```

Field meanings and counting rules: agentbrew `docs/agent-perf.md`.

## 2. Read the report

1. Start with `topKeys` (steps by total time), not `slowest`. A 40-second
   step that runs 30 times costs more than one 5-minute step.
2. Compare `p50Ms` with `p95Ms`. A p95 far above p50 means the step is
   sometimes slow: look for load, a cold cache, or a retry.
3. Check `failuresByKey`. A failed slow step costs its time twice, because
   it runs again.
4. Check `previous` and `sumChangePct`. A step that grew since the last
   window is a regression; name the change that caused it if you can.
5. Ignore steps under a minute in total. They are noise.

## 3. Find a concrete speedup

Pick the top recurring step and ask, in this order:

- Can a narrower command give the same signal while you iterate? (one test
  file, `--changed`, a targeted lint) Keep the full gate for the end.
- Did the same step run twice with no change in between? Remove the repeat.
- Is it waiting on something? (a lock, a network call, a cold install)
  Cache it or run it once.
- Did it fail and retry? Fix the cause of the failure.

A speedup is concrete when it names the step, the change, and the expected
saving (for example: "run `npx vitest run <file>` before `npm run verify`;
saves about 3 minutes per edit loop").

## 4. Write the Time review

Keep it as short as the Stop hook asks, in the final message of the task:

```
Time review: 18m in tools this task.
Longest: npm run verify 3x (p50 4m10s), bats <path> 2m05s.
Speedup: run the one changed test file while iterating; full gate once at the end (saves ~8m).
Recurs: yes, every edit loop in this repo. Filed: <task id or link>.
```

## 5. File a task only when it pays

File a task when the speedup saves 1 minute or more AND the step recurs
(it shows in the 7-day report, not only in this task). Use the repo's task
backend (`detect-task-backend`). The task names the step key, the 7-day
count and total from the report, the change, and the expected saving as its
success measure. Otherwise write "Filed: none (one-off)".

## Rules

- Quote numbers from the report. Never estimate a duration from memory.
- Never paste raw perf rows or commands from transcripts into a task or PR;
  the step key is enough.
- One speedup per review. Pick the biggest.
