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

When `Needed from you` asks the user to check, review, or edit a target, open that target in the same response with the host's editor or browser tool. Give the closing-ask judge the exact report and its opening tool result. The judge returns FAIL for a path-only ask, an unopened target, or an unsupported "opened" claim.

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
