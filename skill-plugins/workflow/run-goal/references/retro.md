# Retro and skill upkeep

Run this at the end of every goal, including a BLOCKED stop. The aim is that
the next goal goes faster, so each finding must change something.

## Screenshots in the final report

The final report often needs before/after screenshots. Get them right in one
try:

- Embed each one as a JPEG data URI of about 100 KB. A `file://` image does not
  load in Playwright `setContent` or in a published Artifact.
- Crop a phone screenshot to the device viewport (iPhone 13: 390x664). A
  full-page capture puts a fixed tab bar in the middle of the image. Open the
  PNG itself, set its width and `height: auto`, then clip to the viewport.

## 1. Collect the facts

- **Timeline**: when you started, when you finished, and the long gaps.
- **Errors**: each failed command or wrong turn, with its cause.
- **Questions asked**: how many, and whether the answers changed the plan. A
  question that did not change the plan was not needed.
- **Interruptions after intake**: the target is zero. Count each time you
  stopped and waited for the user.
- **Metric**: baseline → final, against Success and Pivot.

## 2. What went wrong / what to improve

Write each item as `problem → cause → change`. Examples:

- `Spent 20 min on a sandbox write failure → the hook fixture needs mktemp outside the sandbox → add a gotcha to AGENTS.md`
- `Asked which test runner to use → package.json already said vitest → add an eval where the runner is in package.json and the right answer asks nothing`

Drop an item when you cannot name a change for it.

## 3. Skills used

List every skill you loaded with the Skill tool or followed from a SKILL.md
file in this session. Include `run-goal` itself. If you are unsure, search the
session transcript (Claude Code keeps it under `~/.claude/projects/`) for
`"name":"Skill"` tool calls.

## 4. Find each skill's source

Installed skill folders are often symlinks or synced copies. Edit the source,
never the installed mirror.

- `agentbrew status --verbose` lists the source of each synced skill. Start
  here: agentbrew installs copies under `~/.config/agentbrew/installed-skills/`,
  and those copies are not git repos.
- `readlink -f ~/.claude/skills/<name>` shows a symlink target, for skills
  linked by hand or by a project.
- `git -C <source dir> remote get-url origin` shows who owns the repo.
- agentbrew installs copies, not symlinks, so find run-goal's own local
  checkout with `git -C <dir> remote get-url origin` on candidate folders
  (for example `find ~ -maxdepth 4 -type d -name agentbrew`).

## 5. Route the edit by owner

| Owner | Action |
|---|---|
| The user owns the repo (their local checkout, origin under their account) | Edit the source `SKILL.md` or reference. Add or adjust an eval that would catch the problem. Ship it through that repo's normal delivery flow: branch, gate, PR, and merge when green, if the repo's rules allow the agent to merge. |
| A third party owns it | Do not fork it silently. Add a task to the user's own task queue with the proposed change, or ask at the end before you open an upstream issue or PR. |
| You cannot find the source | Report it as a gap in the final report. |

After the change merges, redeploy it the way that repo says (for agentbrew:
pull, `npm run build`, `agentbrew sync --pull`; plain `sync` skips a skill
that is already installed; `sync --pull` also redeploys changed hook
scripts). Then check that the installed copy shows the
change. A merged edit that never reaches the agent helps nobody.

Keep each edit small. Every skill used gets one update:

- It caused or missed a problem: the change that would have prevented it.
- It worked as written: a new eval case built from this run's scenario, so
  that behavior stays tested. This is a real update, not churn.
Follow the target repo's rules (`AGENTS.md`): tests, docs, commit style, and
leak checks.

Check fast before the full suite. A retro edit can push SKILL.md past its
500-line cap, and only the full suite (minutes) used to catch it. Before
the full suite, run `wc -l` on each edited SKILL.md and the skill's own test
files (`npx vitest run src/skills/<skill>-*.test.ts`). Then run the full
suite once.

### Evals with skill-creator in a goal run

The third-party `skill-creator` skill (anthropics/skills) assumes a human in
the loop. In a goal run:

- Skip the review viewer wait. Its loop opens `generate_review.py` and waits
  for the user's feedback before each revision. Grade the runs yourself
  (`agents/grader.md`), read `benchmark.md`, and revise without waiting. Note
  the skipped human review in the final report.
- Use its exact layout: `<workspace>/eval-<N>-<slug>/<config>/run-<K>/grading.json`.
  The directory name must start with `eval-`. With other names,
  `python -m scripts.aggregate_benchmark` prints "No eval directories found",
  still exits 0, and writes a benchmark with 0% pass rates and "Delta +0.00".
  Treat that line or a run count of 0 as a failed benchmark, not a result.

## 6. Remember

If the agent has a memory tool, store the reusable lessons: decisions with
their reasons, errors with their fixes, and user corrections. Store no
secrets and no raw transcripts.

Keep the memory clean while you store:

- Update an existing entry before you create a new one, and delete entries
  that turned out to be wrong.
- One fact per entry. Write absolute dates, not "yesterday".
- Skip what the repo or git history already records.
- When the goal measured a number (a count, a balance, a timing), store the
  final value with its date. The next run then has a baseline.

When the user corrected how you work, or a standing rule turned out to be
missing, update the source of the user's rules too: `AGENTS.md`, or the file
that generates `CLAUDE.md`. Keep it short: each rule must change behavior.

A skill that worked as written still gets an edit, such as a new eval case.
An existing eval that already covers the run is not an update. The
`goal-retro-before-stop` hook rejects retro lines that say "no change",
"already covers", or "skipped". Write the real commit SHA or PR instead.
`commit_session_legacy` needs `session_id`, `agent_id`, `task_summary`, and
`outcome` (`success`, `partial`, or `failure`). Load its schema first.

Finish the delivery in this session: run the repo's gate yourself, then
merge when it is green. "I'll merge when the gate is green" is not done,
because the session ends and nobody comes back to it. A live run (PR #136)
opened its PR and stopped there.
