---
name: run-goal
description: >
  Turn a goal the user sets into a measurable goal contract, ask at most one
  short round of questions, then work without interruptions until the goal is
  met (or hopelessly blocked), and finish with a review-ready report, a retro,
  and updates to every skill used on the way. Use this skill every time a goal
  is set: the user runs `/goal <condition>` (you see `<command-name>/goal` or
  "Goal set:" or a Stop hook goal condition), or says "work until done",
  "don't stop until", "keep going until", or "here is your goal". Use it even
  when the goal looks simple. Don't use it for `/goal clear` or a bare `/goal`
  status check, or for a one-command question.
---

# Run a goal

A goal is an end state, not an activity. This skill turns the user's words
into an end state that you and the goal checker can both verify. Then it keeps
you working until that end state is true.

## Quick start

Install once: `agentbrew install run-goal`. Then type a goal in Claude Code:

```
/goal make the checkout tests in src/checkout stop flaking
/goal fix the sync bug where a missing commands dir fails, with a regression test, and ship it
/goal let users export their orders as CSV from the web app's orders page, with tests and docs, and ship it
```

The second example is a bug fix, the most common kind of goal. It names the
end state, asks for a failing test first, and approves the PR. The third is a
feature in a web app: it names what users can do, what must come with it
(tests, docs), and approves the PR.

What you will see:

1. The agent reads the repo and takes a baseline. It changes nothing yet.
2. It prints a goal contract: done-criteria, a metric, and a pivot.
3. It asks at most one round of questions. You can skip it.
4. It works alone and prints a `Goal check` line per criterion.
5. It ends with a report, a retro, and updates to the skills it used.

Tips: name an end state, not an activity. Add "and ship it" if a PR is
approved. A filled-in example: [references/goal-contract.md](references/goal-contract.md).

## Order of work

Follow this order, even for a small goal:

1. Read only: look at the repo and take the baseline. No edits yet.
2. **Print the goal contract** (Phase 2) in the chat. This is your first
   real message. Do not call Edit, Write, or any other changing command
   before the contract is in the chat. In Claude Code with agentbrew, the
   `/goal` hook also names a contract file: save the contract there with
   the Write tool (that write is pre-approved and shows in the transcript),
   and say in one chat line that the contract is saved. The
   `goal-contract-before-edit` hook blocks other file edits until that file
   has the "Done when", "Metric", and "Pivot" sections.
3. Ask the one question round, or record your defaults (Phase 3).
4. Work, printing a `Goal check` line after each done-criterion (Phase 4).
5. Verify with fresh evidence (Phase 5), then the retro and the final
   report (Phase 6).

A small goal gets a short contract, not none. Without it, neither you nor the
goal checker knows what "done" means, and the user cannot review your plan.

## Why the transcript matters

In Claude Code, `/goal` sets a session Stop hook. After each turn, a small fast
model reads the condition and the transcript and returns "not yet met", "met",
or "impossible". The checker has no tools. It sees only what you wrote.

So:

- Print evidence (command, exit code, key output line, PR URL) when you finish
  each done-criterion. A claim with no evidence reads as "not yet met".
- When you are hopelessly blocked, say so in plain words. The checker can then
  return "impossible" and release the session.

## Phase 1 — Intake (read only, a few minutes at most)

1. Copy the raw goal text verbatim. You will compare against it at the end.
2. Load the repo context: `AGENTS.md`/`CLAUDE.md`, the task backend, and the
   project-entry script if the repo has one.
3. Search memory and mistake notes for the goal's topic, if a memory tool exists.
4. List the skills that look relevant. Load them when you reach their step, not
   all at once.
5. Find the measurement. Look for an existing test, lint, script, counter, or
   query that can prove the end state. Prefer one that already exists.
6. Spot human-only steps now: secrets, 2FA codes, payments, production
   deploys, and public or destructive actions that no rule approves. Each one
   goes into the contract. If someone is at the keyboard, ask about it in the
   question round. If not, schedule it last.

## Phase 2 — Goal contract

Write the contract in the chat before you change anything. Fill in the template in
[references/goal-contract.md](references/goal-contract.md). Short version:

- **Outcome**: one sentence. What is true when you are done?
- **Done when**: two to five checkable criteria. Each one names a command, a
  file, a URL, or a reviewable artifact.
- **Metric**: the primary number (Goal → Question → Metric), with its baseline,
  target, and the exact command that measures it. Add guard metrics that must
  not get worse (tests, lint, build).
- **Success / Pivot**: the keep threshold, and the threshold below which you
  change approach, not only retry.
- **Scope**: in scope, out of scope, and approvals already granted. Cite the
  source of each approval: a rule file line, the user's answer, or the goal
  text itself (a goal that names an action approves that action). An approval
  you cannot cite, such as "if the repo rules allow it", is not granted.
- **Budget**: rough time or turn budget. Past twice the budget, report and
  re-plan instead of drifting.
- **Assumptions and risks**: what you believe without proof.
- **Suggestions**: one to three ways to make the goal better. For example:
  split it, add a missing metric, reuse a tool, or take a cheaper path. Adopt
  a suggestion by default when it only reduces risk or scope creep, and say so.

Take the baseline measurement now, while nothing has changed yet.

## Phase 3 — One round of questions, only if needed

Ask only when the answer changes what you build, the way you measure it, or
whether an action is allowed. Never ask about something that the code, the
docs, memory, or a quick experiment can answer.

- One round only, three questions at most. Put your recommended option first.
- Give each question its full context. Say what the thing is in plain
  words, what each option does, and what changes for the user. Never ask
  about a hook, flag, file, or internal name without explaining it first:
  the user may not know it, and "I'm not sure what this is" wastes the one
  round.
- Prefer the structured question tool when it exists (`AskUserQuestion` in
  Claude Code).
- Someone is at the keyboard when the structured question tool exists and
  nothing says the run is unattended. Then every assumption that changes
  what you build (which feature, which interface, which storage, what is in
  scope) is a question, not an **Assumptions** line. Keep only the
  assumptions that would not change the deliverable.
- Unattended run (`claude -p`, a scheduled worker, no question tool, or the
  prompt says nobody is around): ask nothing. Pick the recommended default
  and record it under **Assumptions**.
- After the answers, update the contract if needed, then say once:
  "Working autonomously until done or blocked."

## Phase 4 — Execute without interruptions

From here, do not stop for check-ins, progress approvals, or "should I
continue?". The user set a goal so that they can be away.

- Keep a task list (`update_plan`, TodoWrite, or a list in chat), ordered by
  risk: unknowns first.
- Work in small verified steps. Run the guard after each change that matters.
- Log each non-obvious decision in one line: what you chose, and why.
- Never write a result before it exists. A reviewer verdict, a check
  status, or a CI result is `pending` until the reviewer or check has run and
  you have read its output. Filling it in early is a false claim, even if you
  plan to run it next.
- When one part is blocked, park it with a note and continue with the other
  parts. Come back to it later.
- A new request from the user mid-goal joins the goal: add it to the
  contract file as a done-criterion, say so in one line, and deliver it in
  this run. Do not start a separate session for it unless the user asks.
- Approvals the user already gave in this session, in standing rules, or in
  the contract cover their whole class of action. Do not ask again.
- An action that the rules say needs fresh approval (destructive, public,
  outside the workspace, spending money) and that the contract does not
  cover: park it. Do all the other work first. Ask about it at the end, in
  one batch.
- After each done-criterion, print a goal check line:
  `Goal check 2/4 ✅ <criterion> — <evidence>`.

### Hopelessly blocked (the exception)

Stop early only when every remaining path needs something you cannot get:

- a human-only action (a secret, 2FA, a payment, a physical device, a legal
  decision), or
- an approval that the rules require and that nobody has given, or
- three different approaches failed with recorded evidence, and no other
  part of the goal is left to do.

Then write a **BLOCKED** report: what is blocked, the evidence, what you
tried, and the exact action you need from the user. End it with
`Goal status: impossible without <X>.`

## Phase 5 — Verify

Before you claim done, take fresh evidence for every done-criterion. Do not
reuse output from earlier in the session. Run the metric command and compare
it with Success and Pivot. If a criterion fails, go back to Phase 4. The goal
is not done yet.

Read the gate's own exit status, not a line that a wrapper printed. In
`gate; echo "exit $?"` run in the background, the background task reports
the `echo`, which always succeeds. Use `gate; rc=$?` and print `$rc`
(`status` is read-only in zsh), or read the failure lines in the log, before you trust "passed".

When a subagent tool exists, also ask a fresh-context subagent to grade each
criterion against the evidence, one criterion at a time. A grader that did not
do the work is not swayed by your choices. This is the pattern behind Claude
Managed Agents "outcomes" (a rubric plus a separate grader). Fix what it fails
before you report.

## Phase 6 — Retro and skill upkeep

Do this every time, also after a BLOCKED stop. Details:
[references/retro.md](references/retro.md).

1. **What went wrong**: errors, wrong assumptions, wasted loops, and blocked
   time. Give each one its cause.
2. **What to improve**: in the goal wording, the process, the repo, or the
   tooling. Each item is concrete and small.
3. **Skills used**: list every skill you loaded or followed in this session,
   including this one.
4. **Update every one of those skills**: each skill used gets an update, not
   a "no change". If the skill caused or missed a problem, make the edit that
   would have prevented it. If it worked as written, add an eval case built
   from this run's scenario, so the behavior that worked stays tested. Route
   the update by owner (see the retro reference). For skills the user owns,
   edit the source and ship the change through that repo's normal delivery
   flow. Never edit an installed mirror. A third-party skill gets a task with
   the proposed change. `run-goal` itself is never exempt: add an eval case
   from this run to its `evals/evals.json` in its source, or fix the step
   that went wrong. Its source is `skill-plugins/workflow/run-goal/` in the
   agentbrew repo (`github.com/fyodoriv/agentbrew`). agentbrew installs
   copies, not symlinks, so find the local checkout: run
   `git -C <dir> remote get-url origin` on candidate folders (for example
   `find ~ -maxdepth 4 -type d -name agentbrew`). For other skills,
   `agentbrew status --verbose` names the source repo.
   These updates are in scope for every goal: the user asked for them when
   they installed this skill. "Touch only what the request requires" does
   not exclude them. In Claude Code with agentbrew, the `/goal` hook names
   run-goal's local source path.
   A skill in another repo is a cross-repo change. Check the user's rules
   for a standing approval for retro skill updates. With one, make the
   change in a worktree of that repo and ship it by its rules. Without one,
   park it and ask at the end with the exact diff.
5. **Save the retro**: in Claude Code with agentbrew, write the Skills
   updated list to the retro file the `/goal` hook names (pre-approved).
   One line per skill used, each with its commit SHA, PR, or task id. The
   `goal-retro-before-stop` hook keeps the session from ending until every
   skill used has such a line (it gives up after three tries). When you can
   write the skill's source repo, ship the change in this session: gate, PR,
   merge, then cite the PR. When the sandbox or permissions block writes to
   that repo (common when the goal runs in another folder), file a task in
   the user's queue and cite its id; never bypass the sandbox for it.
6. **Remember**: store reusable lessons in memory, if the agent has memory.

## Final report

End with this shape. Keep it short.

```markdown
## Goal result: met | partly met | blocked
**Goal**: <raw goal text, shortened if long>
**Outcome**: <one sentence>

| Done when | Status | Evidence |
|---|---|---|

**Metric**: <baseline> → <now> (target <target>) via `<command>`
**Changes**: <PRs, commits, files>
**What went wrong**: <bullets>
**What to improve**: <bullets>
**Skills updated**: <every skill used, run-goal included → its edit or new eval + PR, or the task for a third-party skill>
**Needed from you**: <the review or the one action, or "nothing">
```
