# Goal report format

Start the plan Artifact after the contract and before execution. Update that
same Artifact at every milestone and on resume. Show evidence, blockers, and
next actions. Verify it is visible in outputs. For private data or an unavailable
Artifact tool, keep one private local HTML report, give its path, and state the
output limitation without claiming publication or blocking work. Update that
same private report at every milestone and reuse it on resume.

```markdown
## Goal result: met | partly met | blocked

Judges: <id> N/10, <id> N/10, <id> N/10 (state <token>), or `pending`.
**Goal**: <raw goal text, shortened if long>
**Outcome**: <one sentence>

| Done when | Status | Evidence |
|---|---|---|

**Metric**: <baseline> → <now> (target <target>) via `<command>`
**Results**: <verified outcomes, PRs, commits, and files>
**Learnings**: <key lessons and estimate versus actual>
**Tooling updated**: <tools, rules, skills, and evals changed, with delivery status, or "nothing">
**What went wrong**: <bullets> · **What to improve**: <bullets>
**Assumptions**: <each marked "my choice" (why, what data would replace it), "from <source>", or "you said">
**Skills updated**: <every skill used, run-goal included → its edit or new eval + PR, or the task for a third-party skill>
Accomplished: <what exactly was done: PRs, commits, files, numbers>
Why useful: <what it changes for the owner, in plain words>
Next task: <the one most useful next task, and why it beats the others>
**Goal progress:** <verified work done, work left, background jobs, agent waits, and next check>
**Needed from you:** <the review or the one action, or "nothing">
```

Use these two fields on every goal status update. Verify running and queued
background work and agent waits before reporting them. Name what each agent
is waiting for. Give the next check time with its time zone, a time interval,
or the event that wakes the agent. Say when no check is scheduled. If a status
cannot be checked, label it unknown. When nothing is running or waiting, say so. Count work against the
verified scope. For a rolling backlog, report dated counts by type and say
the total is unknown. Keep partial work and blockers visible. Use a percentage
only when the numerator and denominator count the same units.

Write a clock time in a report only when you read it from a clock. Run
`date`, or take the time from the tool-call log, and give the time zone.
Never write "about 11:00" from memory: a judge who compares the report with
the log finds the gap and stops trusting the other rows. When a row says
"read today", give the time of that read.

For a nonempty `Needed from you` line, name four details in plain words.
Describe the item and link it or the place to act. Explain why the user
needs to decide.
Say what each option changes for the user. Recommend one option with a
reason. If only one action is possible, explain what remains pending if
the user leaves it alone.

Before sending the ask, get an independent read against the live item.
The reader fails a bare ID, a missing link, an unclear owner action, an
unexplained choice, or a missing recommendation. Revise the ask until it
passes. Use `**Needed from you:** nothing` when no user action is needed.

The three closeout lines (`Accomplished:`, `Why useful:`, `Next task:`) end
every finished goal: the report, the closing chat message, and the retro file.
Name one next task, not a menu; pick the one with the most value per hour,
and say why. The next-action picker below starts from it. A placeholder
(`pending`, `none`, `<...>`) does not count.

## Choose what happens next

At every goal closeout, share the results, lessons, and tooling changes before
asking what to do next. Use interactive choices when available, with a short
numbered list in chat as fallback. Present applicable choices in this order:

1. **File issues and open a follow-up session (Recommended)** when there are
   both untracked gaps and improvements that can proceed. Name each proposed
   issue, its destination, and the scope of the session.
2. **File issues only** when the user wants to track the gaps now. Reuse matching issues.
3. **Open a follow-up session** when the work is already tracked or no new
   issues are needed. State its scope and link the existing work.
4. **Finish here** when the user wants to stop after reviewing the result.

Keep the picker to the applicable choices. When both filing and a session are
useful, offer the combined choice, file issues only, and finish here.
If all gaps already have issues, put the follow-up session first. If there is
no actionable follow-up, say so and finish after sharing the report.

A recommendation does not grant consent. Check authorization for filing.
Open a new session only on an explicit selection or request. For the combined
choice, file or reuse issues first, then give the new session the verified issue links,
the goal report, and the scope the user chose. If any filing fails, report which
issues were filed and which still need action, then wait for a new choice before
opening the session. For unattended runs, record the recommendation in the report.
