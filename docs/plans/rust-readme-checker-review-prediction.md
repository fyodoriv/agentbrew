# README checker source review prediction

A preliminary source scan found a Python checker invoked with a README path by
its skill. This is an observation, not a completed review or registry record.
Register the following before creating an oracle or changing the registry.

- **Hypothesis:** A complete independent review may establish that the exact
  pinned checker is a data parser compatible with the existing narrow compiled
  registry, without treating arbitrary Python or README content as executable.
- **Measurement:** Inspect the pinned file, all entry paths and the named skill
  caller; prepare a source-and-caller oracle, then independently review it
  against `rust/src/reviewed_sources.rs` and the registry contract. No analyzed
  source or physical worker runs during review.
- **Success:** One exact path and blob, whole-program and entry spans, data
  inputs/outputs, every relevant call and caller are accounted for; zero
  unexplained executable, write, generation or dynamic boundaries remain.
  The default path when no argument is supplied is represented or shown outside
  the claimed scope. The oracle and schema agree without changing either to
  conceal a boundary.
- **Pivot:** If any behavior or caller cannot be represented and independently
  justified, keep this source unresolved and do not add a complete record.
  A source review is not a passing inventory or worker qualification.
- **Anchor:** `docs/plans/rust-source-reviewed-registry.md`,
  `rust/src/reviewed_sources.rs`, `skill-plugins/workflow/readme/SKILL.md`,
  and Basili et al. (1994), Goal Question Metric.
