# Sync binding: declare the intentional test entry

The integrated #859 tree passed the nine synthetic controls before formatting
and integration, but a Knip preflight reports `src/sync-selection-binding.prep.ts`
as an unused file. The file is an intentional explicit Vitest entry and is
excluded from default test discovery by design. Do not suppress the warning or
run the expensive full gate while this known failure remains.

Goal: make Knip analyze this intentional test entry without adding a blanket
ignore. Predict the observed one unused-file finding becomes zero by
adding exactly `src/sync-selection-binding.prep.ts` to the existing `entry`
array in `knip.json`. Measure with `npm exec -- knip --no-progress`; success is
exit zero with no unused-file or unused-export findings. The existing Knip
configuration remains otherwise unchanged. The new entry can make its
reachable imports count as used; it is not proof that every other unused item
remains detectable. Any remaining or new finding, or an excluded default test
entering Vitest discovery, rejects this correction. Check discovery with:

```sh
bash <<'BASH'
set -eu
log=$(mktemp)
trap 'rm -f "$log"' EXIT
JOBS=1 heavy-run npm exec -- vitest list --filesOnly --staticParse >"$log"
[ -s "$log" ]
result=0
grep -Eq '(^|/)src/sync-selection-binding\.prep\.ts$' "$log" || result=$?
[ "$result" -eq 1 ]
BASH
```
Run task lint and the ordinary full gate after the correction. Independently
review the exact final head. Register a separate repeat of the isolated nine
controls on that head; the original green predates formatting and integration.

The observed preflight was recorded before this prediction in the local log.
It found exactly one unused file, not a failing full gate. No target selection
case ran. Anchor: repository `knip.json` entry configuration and Basili,
Caldiera and Rombach (1994), Goal Question Metric.

Observed after registration: Knip exited zero and the static default listing
excluded the preparation file. The nine-case repeat on the final head remains
separate.
