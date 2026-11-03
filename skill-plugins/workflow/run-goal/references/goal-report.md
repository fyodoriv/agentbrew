# Goal report format

```markdown
## Goal result: met | partly met | blocked
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

## Choose what happens next

At every goal closeout, share the results, lessons, and tooling changes before
asking what to do next. Use interactive choices when available, with a short
numbered list in chat as fallback. Present applicable choices in this order:

1. **Yes, file issues (Recommended)** when actionable gaps lack an existing
   task. Name each proposed issue and its destination. Reuse matching issues.
2. **Open a follow-up session** for improvements that can proceed. State its
   scope and link the relevant issues or existing work.
3. **Finish here** when the user wants to stop after reviewing the result.

If all gaps already have issues, put the follow-up session first. A suggested
default is not consent. File issues only with applicable authorization. Create
a new session only on an explicit selection or request. If the user chooses
both, file the issues first and pass their links to the follow-up session.
