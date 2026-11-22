# Goal judges: three expert judges must agree

A goal is **met** only when three of the best judges for its field each score
the final result 8/10 or more. A higher score is better: keep improving while
the budget allows. Your own review and green checks are not enough. They show
the work runs. Judges show it is good.

In Claude Code with agentbrew, the `goal-judges-before-stop` hook enforces
this. While the retro says `Goal result: met`, it blocks Stop until the
transcript has fresh verdicts from three judges, each at 8/10 or more.

## 1. Pick the judges

1. Name the goal's fields. A hook change touches developer tooling, shell
   security, and agent reliability. A README touches technical writing and
   developer onboarding.
2. Open the judge cache, `~/.config/agentbrew/goal-judges/` (one file per
   judge). Reuse a judge whose field fits.
3. When none fits, create one. A judge is a field and the methods its best
   experts use, for example "SRE reliability judge: Google SRE book error
   budgets, toil, and failure-mode review". Name the standard works and
   methods it applies. Do not imitate a living person's voice.
4. Pick three different judges. Each one covers a different angle (for
   example, the domain expert, the end user's advocate, and a skeptical
   security or reliability reviewer).

A judge file has this shape:

```markdown
# <judge id>

Field: <field>
Applies: <named standards, books, checklists, metrics>
Rubric (10 = best in the field):
- <criterion>: what earns a 10, what caps it at 6
Blind spots to check: <things this judge missed before>

## Calibration
- <date> session <session id>: <score>/10 on <goal>. Caught: <...>.
  Missed: <...>. Change: <rubric edit made, or "none needed: <why>">.
```

## 2. Run them

Run each judge as a **fresh-context subagent** (the `Agent` tool), after the
last file edit. In its prompt:

- the judge file's text (its persona and rubric),
- the goal contract and the raw goal text,
- where the result is (paths, PR URLs, artifact links, commands to run), not
  your summary of it. The judge inspects the actual result.

Ask it to score 0-10 against its rubric, list its top three fixes (most
valuable first), and end with this block, exactly:

```
GOAL-JUDGE-VERDICT
Judge: <judge id>
Score: <0-10>/10
Cache: <full path of the judge file>
```

Run the three judges in parallel. The hook counts only `Agent` or `Task`
results and their background notifications, never your own text or Bash
output.

## 3. Iterate the work

- Any judge under 8: apply its top fixes, then run **all three** judges
  again. An edit after a verdict makes every verdict stale.
- All at 8 or more: apply cheap top fixes while the budget allows, then
  judge again. Report the lowest and median score.
- No path to 8 within the budget: write `Goal result: partly met (judge
  consensus <lowest>/10)` in the retro. Never claim met without it. After
  five blocks the hook writes that line for you.

Print one goal-check line with the scores, for example
`Goal check judges ✅ 9, 8, 9 (reliability-sre, devex-cli, security-shell)`.

## 4. Iterate the judges

After each use, the runner improves every judge it ran:

1. Append a calibration line with this session id to the judge file (the
   hook checks it).
2. Compare the verdict with later evidence. If the judge missed a defect
   that another judge, a reviewer, or a check found, add it to "Blind spots".
   If it scored high on weak work, tighten the rubric line.
3. Keep the file short: merge repeated lessons into rubric lines.

The cache is personal state on this machine. Keep private data out of it:
name fields and methods, not people's private details or customer data.
