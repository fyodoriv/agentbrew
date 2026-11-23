# Goal judges: three expert judges must agree

A goal is **met** only when three of the best judges for its field each score
the final result 8/10 or more. Higher is better: keep improving while the
budget allows. Green checks show the work runs. Judges show it is good.

In Claude Code with agentbrew, the `goal-judges-before-stop` hook enforces
this, and it is success-gated. While a goal contract exists, it lets Stop
through only when each judge the contract names has exactly one verdict for
the current state, each at 8/10 or more, within three judging rounds, or when
the retro says plainly that the goal is not met. No retro, no `Goal result`
line, or any other form ("met", "done") all need the consensus.

Mid-goal Stops (the question round, a wait on CI) need a retro line
`Goal result: in progress (<why>)` first. A goal that ends below the bar
writes `Goal result: partly met (<lowest score and why>)`. A not-met line
must start with a whole phrase (hyphens are fine): partly met, partially
met, not met, not yet met, unmet, failed, abandoned, cancelled, stopped, in
progress, blocked, impossible, or pending. Only the latest judging round
counts: going back to an earlier passing state after a failing round blocks.

Deleting the contract file during an active goal does not end the gate: the
hook reads the `/goal` command from the transcript and blocks until the
contract is back or the retro says not met.

| Setting | Default | Change it when |
|---|---|---|
| `RUN_GOAL_JUDGE_MIN` | 8 | the owner sets another bar for this machine |
| `RUN_GOAL_JUDGE_COUNT` | 3 | never lower it to pass a goal |
| `RUN_GOAL_JUDGE_MODELS` | 3 | model families needed (opus, sonnet, haiku, fable); lower it only when fewer families can run (then say so in the report) |
| `RUN_GOAL_JUDGE_ROUNDS` | 3 | the owner approves more rounds for one goal |
| `RUN_GOAL_JUDGE_DIR` | `~/.config/agentbrew/goal-judges` | the judge cache lives elsewhere |

**Cost**: one round is three fresh subagents reading the judged paths; a
goal gets at most three rounds, so at most nine judge runs. A round takes
about 3 to 6 minutes of wall time with the judges in parallel. Each judge
and the overseer work to a budget stated in their prompts: about 10 minutes
and a capped number of tool calls (see `goal-judge-prompt.sh`), running a long test suite only when a defect
depends on it.

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
   files. A research or Q&A goal with no repo writes its answer to
   `<state dir>/<session id>.answer.md` (next to the contract; the write is
   pre-approved) and judges that file.
   The judge set, each rubric, and the contract freeze at the goal's first
   judging round: the hook rejects a swapped judge, an edited rubric, or an
   edited contract later, even in a new round. Rubric changes go into `## Calibration` notes and are merged at the
   start of the next goal.
   Put steps that can only happen after the judges pass (merge, install,
   release) under a `## After judging` heading in the contract: the judge
   and overseer prompts leave that section out, so no judge scores them.
   Keep each judged path until the goal's last Stop: a removed worktree
   fails the state check and forces partly met. Remove it after the goal ends.
   The prompt drops contract lines about judge scores (a `N/10` or a score
   with a number), so put targets on their own lines.

   A judge file must meet the rubric floor, or the hook refuses it:
   - `Field:`, `Applies:`, and `Scale:` lines and three or more rubric lines
     with a "capped at" limit;
   - every cap below the passing bar (`RUN_GOAL_JUDGE_MIN`, default 8): a cap
     at 8 or more limits nothing;
   - no rubric line that steers the judge ("trust the summary", "skip the
     tests", "give 9", "minimum score", "benefit of the doubt");
   - once `## Calibration` has notes, a line `Rubric <rubric sha>: <the missed
     defect this rubric fixes>` for the current rubric
     (`bash goal-state.sh --rubric-sha <judge file>` prints the sha). Each
     rubric change must name the defect it fixes, so the owner can audit a
     loosened rubric. After a scored round, the line must cite the state
     token of an earlier score line: the round where the defect was missed.

```markdown
# <judge id>

Field: <field>
Applies: <named standards, books, checklists, metrics>
Rubric (score each line; the final score is the lowest line after caps):
- <criterion>: what earns a 10; capped at 6 when <defect>
- <criterion>: ...; capped at 5 when <defect>
- <criterion>: ...; capped at 7 when <defect>
Scale: 10 best in the field; 8 a top expert would ship it with minor notes;
6 works but has a defect they would block on; 4 serious defects; 2 wrong.
Blind spots to check: <things this judge missed before>

## Calibration
- Rubric <rubric sha>: <the missed defect this rubric version fixes, missed in state <token of that round>>.
- <date> session <session id> state <token>: <score>/10 on <goal>.
  Caught: <...>. Missed: <...>. Next rubric change: <edit, or "none: <why>">.
```

## 2. Judge last

Judge after everything else that edits a judged path: the work, the Phase 6
retro skill updates, and the final report when it is a judged file. Any edit
to a judged path after the verdicts makes them stale. A report outside the
judged paths can get its judge line after the verdicts.

1. For each judge, print its prompt:
   `bash hooks/lib/goal-judge-prompt.sh <contract path> <judge id>` from an
   agentbrew checkout. Outside one, use the installed copy
   `~/.claude/codeassist/hooks-scripts/lib/goal-judge-prompt.sh`; check it
   exists first (`agentbrew sync` installs it with the hook). The contract path is
   `~/.cache/agentbrew/run-goal/<session id>.contract.md`; the `/goal`
   context and every block message name it. The prompt holds the judge's rubric verbatim (its file up to
   `## Calibration`), the state token, the judged paths, the owner's own
   `/goal` words (from `<session>.owner.md`, which the hook rewrites from the
   transcript), the contract labelled as runner-written, and the verdict
   block to end with. The judge does not read the
   judge file: you write its calibration notes, so they are not evidence.
2. Pass that output **unchanged** as the `prompt` of one `Agent` call per
   judge, all three in parallel. The hook rebuilds the prompt and counts a
   verdict only on an exact match, so add nothing: no summary, no hints, no
   score. Leave `subagent_type` out (or use `general-purpose`): a fork
   shares your context, and a custom agent type brings its own system prompt.
   Never message a running judge (SendMessage) and never run practice judges
   (judge markers without the header, or `claude -p` with a judge prompt):
   the hook counts both as a used round.
   Give each judge a different model family, none of them your own (no
   self-judging): on Opus, run `sonnet`, `haiku`, and `fable`. An Agent call
   with no `model`, or `model: inherit`, counts as your own model. Each
   prompt names the judge's role (refuter, spec auditor, or first-time
   user); the script picks it from the state token, so you cannot choose it.
3. The judge ends with this block, once:

```
GOAL-JUDGE-VERDICT
Judge: <judge id>
Score: <0-10>/10
Cache: <full path of the judge file>
State: <state token>
```

The hook counts only `Agent` or `Task` results and their background
notifications (bold field names are fine). Your own text and other Bash
output never count. An Agent call without the header, or a `claude -p`,
`codex exec`, or `ollama run` Bash call, whose result holds a filled-in
verdict block, is an unofficial run: it uses up one round of
`RUN_GOAL_JUDGE_ROUNDS`, so practice runs cannot farm scores. A code review
that only quotes the template returns no verdict, so it is free. The block
message lists `Next step:` (the first problem to fix), the numbered
problems, the honest exit, and each judge's pass rate so far. A result with two verdict blocks counts for none. While a judge
runs in the background with its exact official prompt, the hook lets Stop
through, at most 10 times, and rewrites a met `Goal result:` line to
`in progress (waiting on N judge(s) ...)`: write the result again after the
verdicts. Other background tasks, and a launch with any other prompt, never
excuse a met claim.

4. When every judge has reported, run the **overseer**: one more fresh
   Agent call, on a model family that is not yours. Print its prompt with
   `bash hooks/lib/goal-overseer-prompt.sh <contract path> <transcript path>`
   (outside a checkout, the installed copy next to `goal-judge-prompt.sh`)
   (the transcript is `~/.claude/projects/<project>/<session id>.jsonl`; the
   block message names it) and pass it unchanged. The script quotes each
   judge's report from the transcript, so you cannot trim one. The overseer
   checks every deduction (reproduced, in scope, not an after-judging step),
   looks for misses, splits defects into blockers and follow-ups, and names
   the smallest fix set that reaches the bar. It ends with:

```
GOAL-OVERSEER-VERDICT
State: <state token>
Ruling <judge id>: <0-10>/10 - <one-line reason>
```

   One Ruling line per judge. The hook uses each ruling as that judge's
   effective score, moved at most 2 points from the judge's own score. A
   round with no overseer, an edited overseer prompt, a second overseer on
   one state, or an overseer on your own model family cannot pass. Fix the
   overseer's blockers first: that is how a round stays short.

## 3. Iterate the work

- Any judge under 8: apply its top fixes, then run **all three** again on the
  new state. Judging one judge twice on one state is a re-roll and fails.
  A launch counts, not a verdict: a judge stopped before its verdict and
  launched again on the same state is a re-roll too.
  The state token ignores trailing spaces, line endings, end-of-file blank
  lines, and commits, so such an edit is the same state: it cannot buy a new
  round. A space added or removed inside a line is a real change. A
  goal gets three judging rounds (`RUN_GOAL_JUDGE_ROUNDS`); more rounds farm
  for a lucky score.
- All at 8 or more: apply cheap top fixes while the budget allows, then
  judge again. Report the lowest and median score.
- No path to 8 within the budget: write `Goal result: partly met (judge
  consensus <lowest>/10)`. Never claim met without it. After five blocks the
  hook writes that line for you (five, not three like the retro hook: each
  round needs the judges to run between two Stops).

Print one goal-check line, for example
`Goal check judges ✅ 9, 8, 9 (agent-harness-reliability, llm-evaluation-methodology, devex-workflow-design)`.

## 4. Iterate the judges

After each use, append a calibration line to each judge's `## Calibration`
section with the session id, the state token, and the score as `N/10` (the
hook checks all three; notes there do not change the state token). Compare the verdict with later evidence:

- A defect another judge, a reviewer, or a check found that this judge
  missed: add it as a blind spot in the next rubric change.
- A high score on work that later failed: tighten the rubric line.
- Merge the notes into the rubric at the start of the next goal (step 1.2),
  never mid-goal: the rubric froze at the first round.
  Keep the file short.

The cache is personal state on this machine. Name fields and methods; keep
private data out.

## Without the hook or a subagent tool

- **Codex, OpenCode, or no hook**: follow the same steps and check the rules
  yourself. Run each judge as a fresh process (`claude -p` or `codex exec`
  with the output of `goal-judge-prompt.sh`), never in your own context.
  Then run the overseer the same way, once per state, with the output of
  `goal-overseer-prompt.sh`, and use its rulings as the effective scores.
- **No way to run an independent judge**: write `Goal result: partly met (no
  independent judges available)`. Never judge your own work.

## Where it fails open

The hook allows without a consensus when: the bypass
`HOOK_BYPASS_GOAL_JUDGES_BEFORE_STOP=1` is set during an active goal, no goal
is active (no `/goal`, or after `/goal clear`), the agent has no Stop hook
(Codex), or the session id is unusable.

Known limits (the agent being judged writes the files it is judged by, so a
hook can make these harder, not impossible):

- A lenient judge file you wrote yourself: the rubric floor (caps below the
  bar, no steering lines, a named defect per rubric change) and the prompt's
  rule to apply the field's standard limit it.
- Steering text in the contract: `goal-state.sh` refuses a contract with a
  steering phrase or quoted earlier scores (`scored 5`, `5/7/6`, `round 8
  6/10`), because every judge reads the contract. Keep round history in the
  retro. Steering in words the check does not list is still possible; the
  prompt labels the contract as runner-written and tells judges to report it.
- A practice judge run with a paraphrased prompt and no marker is not seen.
- Small real edits (a comment, a space inside a line) buy a new round, up
  to the three-round cap.
- A rubric loosened when notes are merged at the next goal: once
  `goal-judge-history.tsv` holds a verdict for that judge under another
  rubric, the new `Rubric <sha>:` line must cite one of those scored states,
  wherever it sits in the file. Check its reason against the evidence.
- The round cap counts per `/goal` command: a new `/goal` on the same work
  starts a new cap. The score history keeps every round, so the pass rate
  shows it.
- Files a judge leaves in the judged paths (test output, coverage, logs that
  are not gitignored) change the state token, so its verdict goes stale and
  the next round uses one of the three. Gitignore such output first.
- A `Goal (verbatim)` or `Owner (verbatim)` contract line skips the steering
  check only when its text is in the hook-written `<session>.owner.md`.
- Edits to the installed hook files would fake any verdict.

## Measure the effect

Outcome per goal: the hook's last decision in each real goal session.
Rows for sessions with no goal ("no active goal contract") and test fixtures
(short ids; only UUID session ids count) are left out, so each counted
session is one goal:

```bash
jq -r 'select(.hookId=="goal-judges-before-stop" and ((.sessionId // "") | test("^[0-9a-f]{8}-[0-9a-f]{4}-"))
    and ((.reason // "") | test("no active goal contract") | not))
  | [.sessionId, .decision, .reason] | @tsv' ~/.cache/agentbrew/hook-decisions.jsonl |
  awk -F'\t' '{last[$1]=$2" "$3; if ($2=="block") bl[$1]=1} END{for (s in last) { n++; r=last[s];
    if (r ~ /judge consensus/) c++; else if (r ~ /gave up/) g++; else if (r ~ /bypass/) b++; else o++
    if (bl[s] && r ~ /gave up|not met/) f++ }
    printf "goals %d: consensus %d, gave up %d, met by bypass %d, other %d, blocked then not met %d\n", n, c, g, b, o, f}'
```

"Met by bypass" counts goals that ended met without a consensus; the target
is 0. "Blocked then not met" is the false-block signal: goals the hook held
that then ended below the bar. A high count there means the judges or the
procedure are too strict for real work; review those sessions before you
change the bar. Rows logged before 2026-11-22 predate the test-log isolation
and may hold fixture sessions.
