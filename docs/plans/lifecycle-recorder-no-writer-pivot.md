# Lifecycle recorder: omit the unused writer

The byte-identical transfer in #858 hit its registered pivot: the full gate
failed at Knip because `writeObservation` had no caller
(`src/plugins/lifecycle-observation.ts:14`). A separate local Knip run
reproduced the exact finding. The rejected branch and logs remain intact.

Use a distinct preparation: transfer the same pure recorder and nine health
tests, but omit the unused `writeObservation` function and its `node:fs`
import. This new prediction supersedes #858's byte-identical-transfer condition;
the original plan remains rejected history. Do not add the unqualified
process-group runner, a fake caller, or an ignore rule. The nine-test file
stays byte-identical to #819, SHA-256
`888e881eee65c801cb4fdfbbb0a77ab643d8909014ebea372d1ab62dbe071db4`.
The resulting recorder file must have SHA-256
`8bd67f34257c93702bfb68f7e344b82b0621803de093adb5765b5fd5853cac5d`.

Goal: retain the pure health controls without an unused export. Predict 9/9
named controls pass and Knip changes from the reproduced one unused export to
zero findings. Use the exact nine-name JSON command in the committed
[lifecycle transfer plan](lifecycle-recorder-transfer.md), then run
`npm exec -- knip --no-progress`. Require both commands to exit zero, exact
hashes, the existing CLI lifecycle test unchanged, and the ordinary unfiltered
full gate. Confirm the unqualified `runObservationChild` runner and the closed
controlled source-lease describe are absent before the gate. Independent review
must cover the final head. Any missing case, changed recorder behavior, new
finding, unsafe runner or full-gate regression rejects this distinct approach.

The prior timeout cause remains unknown. This does not qualify real lifecycle
observation or external recorder health. Preserve the original draft and #858
failure evidence. Anchor: the reproduced Knip output and Basili, Caldiera and
Rombach (1994), Goal Question Metric.

Observed after registration: the recorder and test hashes matched, the nine
named controls passed, and Knip exited zero. Real observation and timeout
attribution remain unqualified.
