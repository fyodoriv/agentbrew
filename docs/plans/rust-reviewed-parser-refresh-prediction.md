# Reviewed parser source refresh prediction

A bounded source search found that the existing compiled record's blob differs
from the current parser blob. This establishes staleness, not whether the new
source is safe to admit. Register the following before an oracle or code change.

- **Hypothesis:** A full independent review of the exact current parser and
  callers may support a source-bound replacement record under the existing
  data-parser contract, while rejecting the former or altered source.
- **Measurement:** Compare the recorded and current source, inspect all current
  entry paths and consumers, and independently derive and review an oracle. If
  compatible, run focused synthetic snapshot controls for the exact current
  bytes, stale blob, changed bytes, wrong path, and manifest self-authorization;
  do not execute the analyzed Python source or a physical worker.
- **Success:** All actual source regions and entry modes are accounted for,
  zero unexplained executable/write/generation boundaries remain, the exact
  current record is accepted and every planted stale or forged case is refused.
  Existing unrelated source and diagnostics remain unchanged.
- **Pivot:** Any unsupported behavior, incomplete caller/entry model, mismatch,
  source execution, or unqualified control leaves the record stale and the
  inventory unresolved. Do not broaden a schema or change the frozen corpus to
  force acceptance.
- **Anchor:** `docs/plans/rust-source-reviewed-registry.md`,
  `rust/src/reviewed_sources.rs`, `rust/tests/reviewed_sources.rs`, and Basili
  et al. (1994), Goal Question Metric.

## Source-only result and pivot

The record binds blob `b27c7c158c08ac255496dffd6427bf8763fba3e3`; the current
parser at revision `08de070f` is blob
`fd4447d1593298fd5a92e714d048f0d1ef715b9b`. The change adds a function that
parses a reviewer request and returns a Boolean. The existing command-line
entry reads the transcript path; missing input yields the existing unavailable
result and extra arguments are ignored. The hook supplies an explicit path.

An independent source review found another owned route:
`hooks/lib/review_ask_event.py` loads the parser via `importlib` and calls the
new function. The current whole-program record has a fixed command-line entry
and data regions, but no imported-function entry or caller edge. A textual
caller search is not proof of all callers. Updating only the blob and spans
would silently omit this route, so the registered pivot applies: keep the record
stale and the source unresolved until the import boundary has a reviewed model
and independent oracle. The existing integration controls invoke the snapshot
worker and cannot be treated as no-worker tests. No analyzed Python or worker
was run for this review.

The current `validation::validate` also rejects any second component whose
source path matches a reviewed parser program. Therefore a complete imported
function path would need a separately reviewed discovery, component and typed
edge contract as well as a schema change. A standalone literal oracle cannot
satisfy these obligations. Preserve the stale diagnostic until that complete
path and its independent negative controls are established.
