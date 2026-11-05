# Issue-link evidence in goal retros

Register before changing the hook or its fixtures. Tracks issue #779.

Goal: accept the existing issue-tracking evidence format without weakening
the requirement to name an actual update for every used skill.
Question: does a numeric issue URL supply the same evidence as `#123`?

Hypothesis: false refusals on two valid issue-URL cases fall from 2/2 to 0/2
when the existing evidence expression also recognizes `/issues/[0-9]+`.
Measurement: `heavy-run bash hooks/checks/goal-retro-before-stop.test.sh`.
Add plain-URL and Markdown-link positives, a missing-number negative, and
a negated-update negative. Preserve every existing fixture and assertion.

Success: both new valid cases pass, both new negative cases still block,
and every existing fixture passes. Pivot on any valid refusal or invalid
acceptance; do not relax negation filtering or per-skill evidence checks.
The parser recognizes evidence syntax; it does not verify a remote issue.

Anchor: issue #779's observed false refusal; Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.

Scope: the existing necessary shell hook, its regression fixture and docs.
No new implementation language or network lookup. Estimated active effort:
20–40 minutes plus shared-queue waiting and the repository's required gate.

## Recorded focused result

The unchanged hook refused both valid issue-link fixtures; malformed and
negated cases still blocked. After adding the numeric issue-URL alternative,
the same fixture passed every case. No existing assertion or negation rule
changed. Required repository validation remains a separate delivery gate.
