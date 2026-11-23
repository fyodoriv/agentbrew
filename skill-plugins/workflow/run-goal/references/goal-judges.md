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
| `RUN_GOAL_JUDGE_MODELS` | 2 | model vendors needed; lower it only when no local model can run (then say so in the report) |
| `RUN_GOAL_JUDGE_ROUNDS` | 3 | the owner approves more rounds for one goal |
| `RUN_GOAL_JUDGE_DIR` | `~/.config/agentbrew/goal-judges` | the judge cache lives elsewhere |

**Cost**: one round is two fresh subagents reading the judged paths and one
local model run (about 5 to 9 minutes for a 90 KB diff on qwen3:14b); a goal
gets at most three rounds, so at most nine judge runs.

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
     loosened rubric.

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
- Rubric <rubric sha>: <the missed defect this rubric version fixes>.
- <date> session <session id> state <token>: <score>/10 on <goal>.
  Caught: <...>. Missed: <...>. Next rubric change: <edit, or "none: <why>">.
```

## 2. Judge last

Judge after everything else that edits a judged path: the work, the Phase 6
retro skill updates, and the final report when it is a judged file. Any edit
to a judged path after the verdicts makes them stale. A report outside the
judged paths can get its judge line after the verdicts.

1. For each judge, print its prompt:
   `bash ~/.claude/codeassist/hooks-scripts/lib/goal-judge-prompt.sh <contract path> <judge id>`
   (the `/goal` context names the contract path; its file name is the
   session id). The prompt holds the judge's rubric verbatim (its file up to
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
   the hook rejects both.
   Use at least two model vendors, and give fewer than half the judges your
   own model family. An Agent judge always runs a Claude model (Anthropic),
   so run one judge on a local model:
   `bash <hook lib dir>/goal-judge-local.sh <contract path> <judge id> qwen3:14b`
   in the foreground, exactly in that form (no env prefix, no pipe, no
   `&`), and outside the sandbox (it blocks the Ollama port). The script
   builds the same prompt plus an evidence section (the judged work trees'
   diff against their merge base, non-test files first, cut at 90 KB),
   sends it to Ollama at 127.0.0.1:11434, and prints a header with its
   Prompt-SHA and the answer. The hook rebuilds that sha. Set `model` on one
   Agent judge (for example `sonnet` when you run on Opus); an Agent call
   with no `model`, or `model: inherit`, counts as your own model.
3. The judge ends with this block, once:

```
GOAL-JUDGE-VERDICT
Judge: <judge id>
Score: <0-10>/10
Cache: <full path of the judge file>
State: <state token>
```

The hook counts only `Agent` or `Task` results, their background
notifications, and the output of the exact local judge command (bold field
names are fine). Your own text and other Bash output never count; a
hand-run `ollama` judge or a changed local command counts as an unofficial
run and blocks. A result with two verdict blocks counts for none. While a judge
runs in the background the hook lets Stop through, at most 10 times; other
background tasks never excuse a met claim.

## 3. Iterate the work

- Any judge under 8: apply its top fixes, then run **all three** again on the
  new state. Judging one judge twice on one state is a re-roll and fails.
  The state token ignores whitespace and commits, so a whitespace-only edit
  is the same state: it cannot buy a new round. A
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
- Steering text in the contract: the prompt labels the contract as
  runner-written and tells judges to report such text as a defect.
- A practice judge run with a paraphrased prompt and no marker is not seen.
- Small non-whitespace edits (a comment) buy a new round, up to the
  three-round cap.
- A rubric loosened when notes are merged at the next goal: the `Rubric
  <sha>:` line names why; check it against the calibration evidence.
- A fake server on the Ollama port, or edits to the installed hook files,
  would fake a local verdict.
- The local judge cannot run tools; it judges a diff cut at 90 KB and is told
  to mark unchecked claims as unverified.

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
