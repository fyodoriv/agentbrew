# Independent goal plan artifact review

At creation and at each milestone, give a fresh-context independent reviewer
the goal contract, artifact identity, milestone list, and available evidence.
On resume, also give it the prior artifact identity. Ask it to inspect the
actual artifact and the task outputs, not just the agent's summary. The
reviewer reports each check as pass, fail, or unverified, with its evidence.

1. **Existence and access:** Verify the artifact exists and is visible in task
   outputs. If private data or an unavailable output tool requires the
   documented private local fallback, verify the file, full path, and stated
   output limitation instead. Do not call that fallback published or block
   work merely because output publication is unavailable. A proven missing
   artifact fails this check; an inaccessible listing is unverified.
2. **Order:** Check evidence that the contract came first, the plan existed
   next, and execution began afterward. A current file timestamp alone does
   not prove that order. If history or timestamps cannot establish it, mark
   the order unverified; do not infer it from a narrative. Use existing
   artifact version history or contemporaneous session records when available.
3. **Continuity:** Compare the artifact identity with the prior identity on
   resume and at milestones. A proven different identity fails continuity;
   an unknown prior identity makes it unverified.
4. **Milestones:** Compare completed milestones with the actual artifact.
   Each needs evidence, blockers (or none), and the next action. Flag missing
   entries as failed only when the milestone and plan state are evidenced; distinguish
   an unknown milestone history or inaccessible artifact from a complete one.

Return the checked artifact identity, evidence for each verdict, and any
needed correction. Fix failures and update the same artifact; disclose any
unverified check instead of claiming it passed. Protect private contents in the
review record. An unverified result does not stop ongoing work or the private
fallback, but it cannot support a claim that the check passed. This is a source-owned
review procedure, not a change to the tool-less native goal evaluator.
