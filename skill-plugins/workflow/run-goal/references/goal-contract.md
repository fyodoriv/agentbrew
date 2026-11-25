# Goal contract template

Fill this in the chat before the first change. Delete rows that do not apply.
Keep it scannable: the user reads it once, and the goal checker reads it after
every turn.

```markdown
## Goal contract
**Raw goal**: "<the user's words, verbatim>"
**Outcome**: <one sentence: what is true when this is done>

**Done when**
1. <checkable criterion> — proof: `<command>` / <file> / <URL>
2. ...

**Metric** (Goal → Question → Metric)
- Question: <what we need to know to call it done>
- Primary: <metric>, baseline <value>, target <value>, command `<command>`
- Binding: <definition>; query/source <...>; window <...>; denominator <...>;
  unit <...>; comparator <...>; threshold <...>; user-authorized revision <...>
- Guards (must not get worse): <tests, lint, build, latency, ...>
- Success: <keep threshold> · Pivot: <change-approach threshold>

Judges: <id>, <id>, <id>  (three expert judges from ~/.config/agentbrew/goal-judges; see goal-judges.md)
Judged paths: <worktrees and output files the judges grade>

**Scope**: in — <...>, plus the retro's updates to every skill used · out — <...>
**Approvals already granted**: <each with its source: rule file line or user answer>
**Human-only steps**: <secrets, 2FA, payments, uncited approvals; when they happen>
**Budget**: <rough time or turns>; past 2× → report and re-plan
**Assumptions / risks**: <bullets>
**Suggestions**: <one to three ways to make the goal better, and which you adopt>
**Ambition**: <Altitude | Depth | Range: the one change it brings, or "none: <why>">
**Review deliverable**: <what the user will review at the end: PR, report, demo>
```

## Rules for good criteria

- **One definition for a milestone.** When the sources define a percentage
  differently, list the definitions and ask which applies before counting.
  Then count the full eligible population in the live system of record.
- **Checkable by a command or an artifact.** "Tests pass" is weak. "`npm test`
  exits 0 and `src/foo.test.ts` has a case for the empty input" is strong.
- **Outcome, not activity.** "Wrote a fix" is an activity. "The 500 on
  `/api/orders` no longer reproduces with `curl ...`" is an outcome.
- **No vanity metrics.** Lines changed, commits, and hours always go up. They
  prove nothing.
- **Pick the metric before you see the result.** A metric chosen afterwards
  lets every change look like a success.
- **A bugfix needs a reproduction.** The first criterion is a failing test or
  command that reproduces the bug. The fix makes it pass.
- **Subjective goals get a proxy plus a review.** For "make the page nicer",
  use concrete proxies (zero console errors, Lighthouse score, a screenshot)
  and list "user review of the screenshot" as the last criterion.
- **A "file it as a task" criterion names both ways to meet it.** Write "has a
  task on the default branch, new or existing". Before you promise it, search
  the task queue. For an existing task, quote its line with `git grep` on
  `origin/<default>`. For a finding that no longer reproduces, quote the live
  check that shows it is gone. "I filed no duplicates" alone reads as unmet.
- **End-of-goal background work is accounted for.** List every background job
  and monitor that still runs (a published page arms a live-update monitor on
  its own). Stop each one or say why it stays, by its id.

## Reachable criteria

Before you write "check X passes" or "exits 0", read X's code path to success.
A check can fail closed on purpose, for example "discovery remains
incomplete" after every ledger is filled. Then the work you plan can never
meet that criterion. Ask the user once. Keep the original criterion and mark
it blocked. Replace it with the reachable one ("reviews complete; the check
fails only at the discovery guard") only with the user's explicit approval.
Name the guard under Assumptions and risks. Never delete, weaken or edit the
guard or the check to reach exit 0.

## Example

Raw goal: "fix the flaky checkout tests"

```markdown
## Goal contract
**Raw goal**: "fix the flaky checkout tests"
**Outcome**: The checkout suite passes reliably on main.

**Done when**
1. Each flaky test has a named root cause in the PR body — proof: PR link
2. `for i in $(seq 20); do npx vitest run src/checkout || break; done` passes 20/20
3. No test was skipped or deleted to get there — proof: `git diff --stat` shows no `.skip`
4. PR is merged with the gate green — proof: PR URL + merge commit

**Metric**
- Question: how often does the suite fail on an unchanged tree?
- Primary: failure rate over 20 runs, baseline 4/20, target 0/20
- Guards: full `npm test` green; suite runtime within +10%
- Success: 0/20 · Pivot: still ≥2/20 after two root-cause fixes → re-investigate

Judges: test-reliability, checkout-domain, ci-gate-skeptic
Judged paths: ~/apps/shop/wt/fix-checkout-flake

**Scope**: in — `src/checkout/**` and its fixtures · out — product code changes beyond the race fix
**Approvals already granted**: merge own PRs when green — AGENTS.md "Delivery" step 6
**Human-only steps**: none
**Budget**: about 1 hour
**Assumptions / risks**: flakiness comes from timing, not from a shared fixture
**Suggestions**: add a `--repeat 20` script so the next flake is cheap to prove (adopted)
**Ambition**: Altitude: add the 20-run loop to the pre-merge gate, so "the suite stays stable" holds after this goal (suggested, needs a yes)
**Review deliverable**: merged PR with root causes and the 20-run transcript
```
