# Goal judges: three expert judges must agree

A goal is **met** only when three of the best judges for its field each score
the final result 8/10 or more. Higher is better: keep improving while the
budget allows. Green checks show the work runs. Judges show it is good.

In Claude Code with agentbrew, the `goal-judges-before-stop` hook enforces
this. While the retro says `Goal result: met`, it blocks Stop until each
judge the contract names has exactly one verdict for the current state, each
at 8/10 or more.

## 1. Pick the judges (in the contract, before any work)

1. Name the goal's fields. A hook change touches agent tooling, evaluation
   design, and developer experience. A README touches technical writing and
   onboarding.
2. Open the judge cache, `~/.config/agentbrew/goal-judges/` (one
   `<id>.md` per judge; writes there are pre-approved during a goal). Reuse a
   judge whose field fits. First merge its pending calibration notes into its
   rubric: rubric edits happen only here, before the contract.
3. When none fits, create one with the shape below. A judge is a field and the
   methods its best experts use, for example "SRE reliability: Google SRE
   book error budgets, toil, failure-mode review". Name the standard works.
   Do not imitate a living person's voice.
4. Pick three judges with different angles: the domain expert, the end
   user's advocate, and a skeptical reliability or security reviewer.
5. Add two lines to the contract:

   ```
   Judges: <id>, <id>, <id>
   Judged paths: <repo or folder>, <deliverable file>
   ```

   Judged paths are everything the judges grade: the worktrees, the output
   files. Both lines are frozen: changing them, or a judge's rubric, makes
   every verdict stale. That stops swapping in a softer judge later.

```markdown
# <judge id>

Field: <field>
Applies: <named standards, books, checklists, metrics>
Rubric (score each line; the final score is the lowest line after caps):
- <criterion>: what earns a 10, what caps it at 6
Scale: 10 best in the field; 8 a top expert would ship it with minor notes;
6 works but has a defect they would block on; 4 serious defects; 2 wrong.
Blind spots to check: <things this judge missed before>

## Calibration
- <date> session <session id>: <score>/10 on <goal>. Caught: <...>.
  Missed: <...>. Next rubric change: <edit, or "none: <why>">.
```

## 2. Judge last

Judge after everything else that edits files: the work, the Phase 6 retro
skill updates, and the final report. Any edit to a judged path after the
verdicts makes them stale.

1. Get the state token: `bash ~/.claude/codeassist/hooks-scripts/lib/goal-state.sh
   <contract path>` (the `/goal` context names the contract path; its file
   name is the session id). It hashes the contract, the three rubrics, and
   the judged paths (git HEAD, status, diff, untracked files).
2. Run each judge once as a **fresh-context subagent** (the `Agent` tool), all
   three in parallel. Use at least two models: set `model` on one judge (for
   example `sonnet` when you run on Opus). Same-model judges share blind
   spots. Each prompt has:
   - the judge file's full path (the hook checks the prompt names it),
   - the raw goal text, the contract path, and the state token,
   - where the result is (paths, PR URLs, commands). Not your summary.
     Never suggest a score.
3. Ask for a score per rubric line with evidence (file:line, command output),
   the top three fixes, and this block at the end, exactly once:

```
GOAL-JUDGE-VERDICT
Judge: <judge id>
Score: <0-10>/10
Cache: <full path of the judge file>
State: <state token>
```

The hook counts only `Agent` or `Task` results and their background
notifications. Your own text and Bash output never count. A result with two
verdict blocks counts for none.

## 3. Iterate the work

- Any judge under 8: apply its top fixes, then run **all three** again on the
  new state. Judging one judge twice on one state is a re-roll and fails.
- All at 8 or more: apply cheap top fixes while the budget allows, then
  judge again. Report the lowest and median score.
- No path to 8 within the budget: write `Goal result: partly met (judge
  consensus <lowest>/10)`. Never claim met without it. After five blocks the
  hook writes that line for you.

Print one goal-check line, for example
`Goal check judges ✅ 9, 8, 9 (agent-harness-reliability, llm-evaluation-methodology, devex-workflow-design)`.

## 4. Iterate the judges

After each use, append a calibration line with this session id to each
judge's `## Calibration` section (the hook checks it; notes there do not
change the state token). Compare the verdict with later evidence:

- A defect another judge, a reviewer, or a check found that this judge
  missed: add it as a blind spot in the next rubric change.
- A high score on work that later failed: tighten the rubric line.
- Merge the notes into the rubric at the start of the next goal (step 1.2).
  Keep the file short.

The cache is personal state on this machine. Name fields and methods; keep
private data out.

## Without the hook or a subagent tool

- **Codex, OpenCode, or no hook**: follow the same steps and check the rules
  yourself. Run each judge as a fresh process (`claude -p` or `codex exec`
  with the judge file and the token), never in your own context.
- **No way to run an independent judge**: write `Goal result: partly met (no
  independent judges available)`. Never judge your own work.

## Measure the effect

Consensus rate, give-ups, and lowest scores over the last 30 days:

```bash
jq -r 'select(.hookId=="goal-judges-before-stop") | .reason' ~/.cache/agentbrew/hook-decisions.jsonl |
  awk '/^judge consensus/{c++; split($0,a,"lowest "); sub("/.*","",a[2]); s+=a[2]} /^gave up/{g++} /no judge consensus/{b++}
       END{printf "consensus %d, gave up %d, blocks %d, mean lowest %.1f\n", c, g, b, (c?s/c:0)}'
```
