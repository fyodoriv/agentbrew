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
