# Prove that a replacement keeps a pull request's work

## Registered experiment

Goal: prevent a duplicate or superseded pull request from losing work. Question: after applying the proposed change to the replacement, is the resulting Git tree identical to the replacement? Metrics: accepted unique changes, refused true duplicates, and changes to the caller's checkout.

Hypothesis: the archived unstaged-diff check misses one staged unique edit. A three-way apply in a disposable index followed by an exact tree comparison rejects that edit and keeps true duplicates eligible.

Measurement: reproduce the archived `git apply --3way` and `git diff --stat` sequence in a disposable checkout. Run `node scripts/verify-pr-closure-is-lossless.mjs --closed <number> --survivor <number>` on the registered fixture pairs and inspect the last ten closed Agentbrew PRs for independently identified duplicate pairs. The read-only command accepts exact GitHub revisions and performs no pull request write.

Success: zero accepted unique changes, zero refused true duplicates, and zero changes to the caller's index, ref, or worktree. The fixture covers an exact duplicate, an independently committed duplicate, a unique addition, a binary change, and a conflict. Record how many of the ten real closes are verifiable duplicate pairs.

Pivot: any false approval, more than one false refusal in ten verifiable cases, uncertain GitHub identity, changed external revision, or a failed required check rejects the candidate. A case without a verified replacement is inconclusive.

Anchor: Minsky's `scripts/verify-pr-closure-is-lossless.mjs`, Agentbrew task `lossless-pr-close`, and Forsgren, Humble and Kim (2018), *Accelerate*.

## Live identity control

The ten latest closed, unmerged Agentbrew PRs carry no explicit replacement
in the checked bodies and comments. Keep their true-duplicate rate
unqualified. For a separate negative route, give the checker proposal
[#1040](https://github.com/fyodoriv/agentbrew/pull/1040) and merged PR
[#1041](https://github.com/fyodoriv/agentbrew/pull/1041) as a deliberately
different replacement. Their public file lists differ. Predict exit one
with the one-step install test as missing, and no changes to the caller's
checkout. Any successful preservation result rejects this control.

## Observed results

The archived command left the unstaged diff empty while one unique file
change was staged. The candidate accepted both duplicate trees, named a
unique text file and a unique binary file, and refused a conflicting
tree. All five local controls preserved the caller's index and checkout.

The live command refused the #1040/#1041 pair and named
`real-e2e/scenarios/us01-one-step-install.test.ts`. The caller's index,
commit and working tree did not change. This is a negative control. The
ten examined closes still need verified replacement links to measure
the false-refusal rate.

## Identity and merge-base controls

Require the exact repository from the caller's origin in each GitHub read.
A fixture returns two valid PR numbers from a different repository.
Predict exit one even when all named Git objects exist locally.

A criss-cross Git graph gives the proposal two best merge bases. Predict
exit one before applying any patch. Both controls must preserve the
caller. A positive result names the repository and exact revisions. It
applies at the time of verification, so delivery rechecks those revisions
immediately before any authorized closure.

Both new controls refused the pair. The ambiguous graph had exactly two
best merge bases. The live #1040/#1041 check still named the missing file
when bound to the caller's GitHub origin.
